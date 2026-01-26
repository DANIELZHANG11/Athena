"""
LLM 服务商适配层

支持的服务商:
- SiliconFlow (硅基流动): OpenAI 兼容格式
- OpenRouter: OpenAI 兼容格式 (备用)

职责:
- 统一 LLM 调用接口
- SSE 流式响应
- Token 计数
- 错误处理与重试
"""

import json
import os
from abc import ABC, abstractmethod
from dataclasses import dataclass
from typing import Any, AsyncIterator, Optional

import httpx
from prometheus_client import Counter, Histogram

# Prometheus 指标
LLM_REQUEST_LATENCY = Histogram(
    "llm_request_latency_seconds",
    "LLM request latency in seconds",
    ["provider", "model"],
)
LLM_REQUEST_TOTAL = Counter(
    "llm_request_total",
    "Total LLM requests",
    ["provider", "model", "status"],
)
LLM_TOKENS_TOTAL = Counter(
    "llm_tokens_total",
    "Total tokens consumed",
    ["provider", "model", "type"],  # metric_type: prompt/completion
)


@dataclass
class ChatMessage:
    """聊天消息"""

    role: str  # system, user, assistant
    content: str


@dataclass
class LLMUsage:
    """Token 使用统计"""

    prompt_tokens: int
    completion_tokens: int
    total_tokens: int


@dataclass
class LLMStreamChunk:
    """流式响应块"""

    type: str  # "delta" | "usage" | "done" | "error"
    content: Optional[str] = None
    usage: Optional[LLMUsage] = None
    error: Optional[str] = None
    finish_reason: Optional[str] = None


class LLMProvider(ABC):
    """LLM 服务商抽象基类"""

    provider_name: str = "base"

    @abstractmethod
    async def chat_stream(
        self,
        messages: list[ChatMessage],
        model: str,
        *,
        temperature: float = 0.7,
        max_tokens: int = 4096,
        stop: Optional[list[str]] = None,
        **kwargs,
    ) -> AsyncIterator[LLMStreamChunk]:
        """流式聊天完成"""
        pass

    @abstractmethod
    async def chat(
        self,
        messages: list[ChatMessage],
        model: str,
        *,
        temperature: float = 0.7,
        max_tokens: int = 4096,
        **kwargs,
    ) -> tuple[str, LLMUsage]:
        """非流式聊天完成，返回 (回复内容, 使用统计)"""
        pass


class SiliconFlowProvider(LLMProvider):
    """
    硅基流动 (SiliconFlow) LLM 服务商

    API 文档: https://docs.siliconflow.cn/cn/api-reference/chat-completions/chat-completions
    兼容 OpenAI 格式
    """

    provider_name = "siliconflow"
    base_url = "https://api.siliconflow.cn/v1"

    def __init__(self, api_key: str, base_url: Optional[str] = None):
        self.api_key = api_key
        if base_url:
            self.base_url = base_url.rstrip("/")

    def _make_headers(self) -> dict[str, str]:
        return {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json",
        }

    def _messages_to_dict(self, messages: list[ChatMessage]) -> list[dict]:
        return [{"role": m.role, "content": m.content} for m in messages]

    async def chat_stream(
        self,
        messages: list[ChatMessage],
        model: str,
        *,
        temperature: float = 0.7,
        max_tokens: int = 4096,
        stop: Optional[list[str]] = None,
        **kwargs,
    ) -> AsyncIterator[LLMStreamChunk]:
        """流式聊天完成"""
        url = f"{self.base_url}/chat/completions"
        payload = {
            "model": model,
            "messages": self._messages_to_dict(messages),
            "stream": True,
            "temperature": temperature,
            "max_tokens": max_tokens,
        }
        if stop:
            payload["stop"] = stop

        # 合并额外参数
        for k, v in kwargs.items():
            if v is not None:
                payload[k] = v

        try:
            async with httpx.AsyncClient(timeout=120.0) as client:
                async with client.stream(
                    "POST",
                    url,
                    headers=self._make_headers(),
                    json=payload,
                ) as response:
                    if response.status_code != 200:
                        error_text = await response.aread()
                        LLM_REQUEST_TOTAL.labels(
                            provider=self.provider_name,
                            model=model,
                            status="error",
                        ).inc()
                        yield LLMStreamChunk(
                            type="error",
                            error=f"HTTP {response.status_code}: {error_text.decode()}",
                        )
                        return

                    LLM_REQUEST_TOTAL.labels(
                        provider=self.provider_name,
                        model=model,
                        status="success",
                    ).inc()

                    last_usage: Optional[LLMUsage] = None

                    async for line in response.aiter_lines():
                        if not line:
                            continue
                        if not line.startswith("data: "):
                            continue

                        data = line[6:]  # 去掉 "data: " 前缀

                        if data == "[DONE]":
                            # 流结束
                            if last_usage:
                                yield LLMStreamChunk(type="usage", usage=last_usage)
                            yield LLMStreamChunk(type="done")
                            return

                        try:
                            chunk = json.loads(data)
                            choices = chunk.get("choices", [])

                            # 提取 usage (有些 provider 在最后一个 chunk 返回)
                            if "usage" in chunk and chunk["usage"]:
                                u = chunk["usage"]
                                last_usage = LLMUsage(
                                    prompt_tokens=u.get("prompt_tokens", 0),
                                    completion_tokens=u.get("completion_tokens", 0),
                                    total_tokens=u.get("total_tokens", 0),
                                )

                            if choices:
                                choice = choices[0]
                                delta = choice.get("delta", {})
                                content = delta.get("content")
                                finish_reason = choice.get("finish_reason")

                                if content:
                                    yield LLMStreamChunk(
                                        type="delta",
                                        content=content,
                                    )

                                if finish_reason:
                                    yield LLMStreamChunk(
                                        type="delta",
                                        finish_reason=finish_reason,
                                    )

                        except json.JSONDecodeError:
                            continue

        except httpx.TimeoutException:
            LLM_REQUEST_TOTAL.labels(
                provider=self.provider_name,
                model=model,
                status="timeout",
            ).inc()
            yield LLMStreamChunk(type="error", error="Request timeout")
        except Exception as e:
            LLM_REQUEST_TOTAL.labels(
                provider=self.provider_name,
                model=model,
                status="error",
            ).inc()
            yield LLMStreamChunk(type="error", error=str(e))

    async def chat(
        self,
        messages: list[ChatMessage],
        model: str,
        *,
        temperature: float = 0.7,
        max_tokens: int = 4096,
        **kwargs,
    ) -> tuple[str, LLMUsage]:
        """非流式聊天完成"""
        url = f"{self.base_url}/chat/completions"
        payload = {
            "model": model,
            "messages": self._messages_to_dict(messages),
            "stream": False,
            "temperature": temperature,
            "max_tokens": max_tokens,
        }

        for k, v in kwargs.items():
            if v is not None:
                payload[k] = v

        async with httpx.AsyncClient(timeout=120.0) as client:
            response = await client.post(
                url,
                headers=self._make_headers(),
                json=payload,
            )

            if response.status_code != 200:
                LLM_REQUEST_TOTAL.labels(
                    provider=self.provider_name,
                    model=model,
                    status="error",
                ).inc()
                raise Exception(f"HTTP {response.status_code}: {response.text}")

            LLM_REQUEST_TOTAL.labels(
                provider=self.provider_name,
                model=model,
                status="success",
            ).inc()

            data = response.json()
            content = data["choices"][0]["message"]["content"]
            usage_data = data.get("usage", {})
            usage = LLMUsage(
                prompt_tokens=usage_data.get("prompt_tokens", 0),
                completion_tokens=usage_data.get("completion_tokens", 0),
                total_tokens=usage_data.get("total_tokens", 0),
            )

            # 记录 token 指标
            LLM_TOKENS_TOTAL.labels(
                provider=self.provider_name,
                model=model,
                type="prompt",
            ).inc(usage.prompt_tokens)
            LLM_TOKENS_TOTAL.labels(
                provider=self.provider_name,
                model=model,
                type="completion",
            ).inc(usage.completion_tokens)

            return content, usage


class OpenRouterProvider(LLMProvider):
    """
    OpenRouter LLM 服务商 (备用)

    API 文档: https://openrouter.ai/docs
    兼容 OpenAI 格式
    """

    provider_name = "openrouter"
    base_url = "https://openrouter.ai/api/v1"

    def __init__(self, api_key: str, base_url: Optional[str] = None):
        self.api_key = api_key
        if base_url:
            self.base_url = base_url.rstrip("/")

    def _make_headers(self) -> dict[str, str]:
        return {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json",
            "HTTP-Referer": "https://athena.app",  # OpenRouter 要求
            "X-Title": "Athena Reader",
        }

    def _messages_to_dict(self, messages: list[ChatMessage]) -> list[dict]:
        return [{"role": m.role, "content": m.content} for m in messages]

    async def chat_stream(
        self,
        messages: list[ChatMessage],
        model: str,
        *,
        temperature: float = 0.7,
        max_tokens: int = 4096,
        stop: Optional[list[str]] = None,
        **kwargs,
    ) -> AsyncIterator[LLMStreamChunk]:
        """流式聊天完成 - 与 SiliconFlow 实现类似"""
        # OpenRouter 格式与 SiliconFlow 相同，复用逻辑
        url = f"{self.base_url}/chat/completions"
        payload = {
            "model": model,
            "messages": self._messages_to_dict(messages),
            "stream": True,
            "temperature": temperature,
            "max_tokens": max_tokens,
        }
        if stop:
            payload["stop"] = stop

        for k, v in kwargs.items():
            if v is not None:
                payload[k] = v

        try:
            async with httpx.AsyncClient(timeout=120.0) as client:
                async with client.stream(
                    "POST",
                    url,
                    headers=self._make_headers(),
                    json=payload,
                ) as response:
                    if response.status_code != 200:
                        error_text = await response.aread()
                        LLM_REQUEST_TOTAL.labels(
                            provider=self.provider_name,
                            model=model,
                            status="error",
                        ).inc()
                        yield LLMStreamChunk(
                            type="error",
                            error=f"HTTP {response.status_code}: {error_text.decode()}",
                        )
                        return

                    LLM_REQUEST_TOTAL.labels(
                        provider=self.provider_name,
                        model=model,
                        status="success",
                    ).inc()

                    last_usage: Optional[LLMUsage] = None

                    async for line in response.aiter_lines():
                        if not line:
                            continue
                        if not line.startswith("data: "):
                            continue

                        data = line[6:]

                        if data == "[DONE]":
                            if last_usage:
                                yield LLMStreamChunk(type="usage", usage=last_usage)
                            yield LLMStreamChunk(type="done")
                            return

                        try:
                            chunk = json.loads(data)
                            choices = chunk.get("choices", [])

                            if "usage" in chunk and chunk["usage"]:
                                u = chunk["usage"]
                                last_usage = LLMUsage(
                                    prompt_tokens=u.get("prompt_tokens", 0),
                                    completion_tokens=u.get("completion_tokens", 0),
                                    total_tokens=u.get("total_tokens", 0),
                                )

                            if choices:
                                choice = choices[0]
                                delta = choice.get("delta", {})
                                content = delta.get("content")
                                finish_reason = choice.get("finish_reason")

                                if content:
                                    yield LLMStreamChunk(type="delta", content=content)

                                if finish_reason:
                                    yield LLMStreamChunk(
                                        type="delta", finish_reason=finish_reason
                                    )

                        except json.JSONDecodeError:
                            continue

        except httpx.TimeoutException:
            LLM_REQUEST_TOTAL.labels(
                provider=self.provider_name,
                model=model,
                status="timeout",
            ).inc()
            yield LLMStreamChunk(type="error", error="Request timeout")
        except Exception as e:
            LLM_REQUEST_TOTAL.labels(
                provider=self.provider_name,
                model=model,
                status="error",
            ).inc()
            yield LLMStreamChunk(type="error", error=str(e))

    async def chat(
        self,
        messages: list[ChatMessage],
        model: str,
        *,
        temperature: float = 0.7,
        max_tokens: int = 4096,
        **kwargs,
    ) -> tuple[str, LLMUsage]:
        """非流式聊天完成"""
        url = f"{self.base_url}/chat/completions"
        payload = {
            "model": model,
            "messages": self._messages_to_dict(messages),
            "stream": False,
            "temperature": temperature,
            "max_tokens": max_tokens,
        }

        for k, v in kwargs.items():
            if v is not None:
                payload[k] = v

        async with httpx.AsyncClient(timeout=120.0) as client:
            response = await client.post(
                url,
                headers=self._make_headers(),
                json=payload,
            )

            if response.status_code != 200:
                LLM_REQUEST_TOTAL.labels(
                    provider=self.provider_name,
                    model=model,
                    status="error",
                ).inc()
                raise Exception(f"HTTP {response.status_code}: {response.text}")

            LLM_REQUEST_TOTAL.labels(
                provider=self.provider_name,
                model=model,
                status="success",
            ).inc()

            data = response.json()
            content = data["choices"][0]["message"]["content"]
            usage_data = data.get("usage", {})
            usage = LLMUsage(
                prompt_tokens=usage_data.get("prompt_tokens", 0),
                completion_tokens=usage_data.get("completion_tokens", 0),
                total_tokens=usage_data.get("total_tokens", 0),
            )

            return content, usage


# ============================================================================
# Provider Factory
# ============================================================================


def get_provider(
    provider_name: str,
    api_key: str,
    base_url: Optional[str] = None,
) -> LLMProvider:
    """
    获取 LLM Provider 实例

    Args:
        provider_name: 服务商名称 (siliconflow, openrouter)
        api_key: API 密钥
        base_url: 可选的自定义 API 地址

    Returns:
        LLMProvider 实例
    """
    providers = {
        "siliconflow": SiliconFlowProvider,
        "openrouter": OpenRouterProvider,
    }

    provider_class = providers.get(provider_name.lower())
    if not provider_class:
        raise ValueError(f"Unknown provider: {provider_name}. Supported: {list(providers.keys())}")

    return provider_class(api_key=api_key, base_url=base_url)


# ============================================================================
# 默认 Provider (从环境变量初始化)
# ============================================================================

_default_provider: Optional[LLMProvider] = None


def get_default_provider() -> LLMProvider:
    """获取默认 LLM Provider (从环境变量)"""
    global _default_provider

    if _default_provider is None:
        api_key = os.getenv("SILICONFLOW_API_KEY", "")
        if api_key:
            _default_provider = SiliconFlowProvider(api_key=api_key)
        else:
            # Fallback to OpenRouter
            api_key = os.getenv("OPENROUTER_API_KEY", "")
            if api_key:
                _default_provider = OpenRouterProvider(api_key=api_key)
            else:
                raise ValueError(
                    "No LLM API key configured. Set SILICONFLOW_API_KEY or OPENROUTER_API_KEY."
                )

    return _default_provider


def set_default_provider(provider: LLMProvider) -> None:
    """设置默认 LLM Provider"""
    global _default_provider
    _default_provider = provider


# ============================================================================
# Reranker 重排序服务
# ============================================================================

@dataclass
class RerankResult:
    """重排序结果"""
    index: int  # 原始文档索引
    relevance_score: float  # 相关性得分 (0-1)
    text: Optional[str] = None  # 文档文本（可选返回）


class SiliconFlowReranker:
    """
    硅基流动 Reranker 服务
    
    API 文档: https://docs.siliconflow.cn/cn/api-reference/rerank/create-rerank
    
    支持的模型:
    - BAAI/bge-reranker-v2-m3 (推荐)
    - Pro/BAAI/bge-reranker-v2-m3
    - netease-youdao/bce-reranker-base_v1
    - Qwen/Qwen3-Reranker-8B/4B/0.6B
    """
    
    base_url = "https://api.siliconflow.cn/v1"
    default_model = "BAAI/bge-reranker-v2-m3"
    
    def __init__(self, api_key: str, base_url: Optional[str] = None):
        self.api_key = api_key
        if base_url:
            self.base_url = base_url.rstrip("/")
    
    def _make_headers(self) -> dict[str, str]:
        return {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json",
        }
    
    async def rerank(
        self,
        query: str,
        documents: list[str],
        *,
        model: str | None = None,
        top_n: int | None = None,
        return_documents: bool = False,
        max_chunks_per_doc: int | None = None,
    ) -> list[RerankResult]:
        """
        对文档进行重排序
        
        Args:
            query: 查询文本
            documents: 待排序的文档列表
            model: 使用的模型（默认 BAAI/bge-reranker-v2-m3）
            top_n: 返回前 N 个结果（默认全部返回）
            return_documents: 是否返回文档文本
            max_chunks_per_doc: 每个文档的最大块数（用于长文档）
        
        Returns:
            按相关性降序排列的 RerankResult 列表
        """
        if not documents:
            return []
        
        url = f"{self.base_url}/rerank"
        payload: dict[str, Any] = {
            "model": model or self.default_model,
            "query": query,
            "documents": documents,
            "return_documents": return_documents,
        }
        
        if top_n is not None:
            payload["top_n"] = top_n
        if max_chunks_per_doc is not None:
            payload["max_chunks_per_doc"] = max_chunks_per_doc
        
        try:
            async with httpx.AsyncClient(timeout=60.0) as client:
                response = await client.post(
                    url,
                    headers=self._make_headers(),
                    json=payload,
                )
                
                if response.status_code != 200:
                    raise Exception(f"Rerank API error: HTTP {response.status_code}: {response.text}")
                
                data = response.json()
                results = []
                
                for item in data.get("results", []):
                    text = None
                    if return_documents and "document" in item:
                        text = item["document"].get("text")
                    
                    results.append(RerankResult(
                        index=item["index"],
                        relevance_score=item["relevance_score"],
                        text=text,
                    ))
                
                # API 已按 relevance_score 降序排列，直接返回
                return results
                
        except httpx.TimeoutException:
            raise Exception("Rerank API timeout")
        except Exception as e:
            raise Exception(f"Rerank API error: {e}")


# 全局 Reranker 实例
_reranker: Optional[SiliconFlowReranker] = None


def get_reranker() -> Optional[SiliconFlowReranker]:
    """获取 Reranker 实例"""
    global _reranker
    
    if _reranker is None:
        api_key = os.getenv("SILICONFLOW_API_KEY", "")
        if api_key:
            _reranker = SiliconFlowReranker(api_key=api_key)
    
    return _reranker
