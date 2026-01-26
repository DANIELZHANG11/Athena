"""
AI 聊天功能测试

测试覆盖:
- LLM Provider Mock 测试
- 对话 CRUD 测试
- SSE 流式响应测试
- Credits 扣费测试
"""

import json
import pytest
from unittest.mock import AsyncMock, MagicMock, patch
from httpx import AsyncClient

from app.services.llm_provider import (
    LLMProvider,
    LLMStreamChunk,
    LLMUsage,
    ChatMessage,
    SiliconFlowProvider,
    get_provider,
)


# ============================================================================
# LLM Provider Tests
# ============================================================================


class TestSiliconFlowProvider:
    """硅基流动 Provider 测试"""

    @pytest.fixture
    def provider(self):
        return SiliconFlowProvider(api_key="test-api-key")

    def test_init(self, provider):
        assert provider.api_key == "test-api-key"
        assert provider.base_url == "https://api.siliconflow.cn/v1"
        assert provider.provider_name == "siliconflow"

    def test_messages_to_dict(self, provider):
        messages = [
            ChatMessage(role="system", content="You are a helpful assistant."),
            ChatMessage(role="user", content="Hello"),
        ]
        result = provider._messages_to_dict(messages)
        assert result == [
            {"role": "system", "content": "You are a helpful assistant."},
            {"role": "user", "content": "Hello"},
        ]

    @pytest.mark.asyncio
    async def test_chat_stream_success(self, provider):
        """测试流式响应成功场景"""
        mock_response = MagicMock()
        mock_response.status_code = 200

        # 模拟 SSE 响应
        async def mock_iter_lines():
            yield 'data: {"choices":[{"delta":{"content":"Hello"}}]}'
            yield 'data: {"choices":[{"delta":{"content":" World"}}]}'
            yield 'data: {"choices":[{"delta":{}}],"usage":{"prompt_tokens":10,"completion_tokens":5,"total_tokens":15}}'
            yield "data: [DONE]"

        mock_response.aiter_lines = mock_iter_lines

        with patch("httpx.AsyncClient.stream") as mock_stream:
            mock_cm = AsyncMock()
            mock_cm.__aenter__.return_value = mock_response
            mock_cm.__aexit__.return_value = None
            mock_stream.return_value = mock_cm

            messages = [ChatMessage(role="user", content="Hi")]
            chunks = []

            async for chunk in provider.chat_stream(messages, "test-model"):
                chunks.append(chunk)

            # 验证收到的 chunks
            delta_chunks = [c for c in chunks if c.type == "delta" and c.content]
            assert len(delta_chunks) >= 1


class TestGetProvider:
    """Provider 工厂测试"""

    def test_get_siliconflow_provider(self):
        provider = get_provider("siliconflow", "test-key")
        assert isinstance(provider, SiliconFlowProvider)
        assert provider.api_key == "test-key"

    def test_get_unknown_provider(self):
        with pytest.raises(ValueError, match="Unknown provider"):
            get_provider("unknown", "test-key")


# ============================================================================
# AI API Tests
# ============================================================================


@pytest.fixture
def mock_user_auth():
    """模拟用户认证"""
    return ("test-user-id", "user")


@pytest.fixture
def mock_admin_auth():
    """模拟管理员认证"""
    return ("admin-user-id", "admin")


class TestAIConversationsAPI:
    """AI 对话 API 测试"""

    @pytest.mark.asyncio
    async def test_list_conversations(self, mock_user_auth):
        """测试列出对话"""
        from app.ai import list_conversations

        with patch("app.ai.engine") as mock_engine:
            mock_conn = AsyncMock()
            mock_result = MagicMock()
            mock_result.fetchall.return_value = [
                ("conv-1", "Test Conv", "2024-01-01", "2024-01-02", "chat", []),
            ]
            mock_result.scalar.return_value = 1
            mock_conn.execute.return_value = mock_result
            mock_engine.begin.return_value.__aenter__.return_value = mock_conn

            result = await list_conversations(auth=mock_user_auth)

            assert result["status"] == "success"
            assert len(result["data"]) == 1
            assert result["data"][0]["id"] == "conv-1"

    @pytest.mark.asyncio
    async def test_create_conversation(self, mock_user_auth):
        """测试创建对话"""
        from app.ai import create_conversation, CreateConversationRequest

        with patch("app.ai.engine") as mock_engine:
            mock_conn = AsyncMock()
            mock_engine.begin.return_value.__aenter__.return_value = mock_conn

            body = CreateConversationRequest(title="Test", mode="chat")
            result = await create_conversation(body=body, auth=mock_user_auth)

            assert result["status"] == "success"
            assert "id" in result["data"]

    @pytest.mark.asyncio
    async def test_send_message_insufficient_credits(self, mock_user_auth):
        """测试 Credits 不足场景"""
        from app.ai import send_message, SendMessageRequest
        from fastapi import HTTPException

        with patch("app.ai.engine") as mock_engine:
            mock_conn = AsyncMock()
            
            # 模拟对话存在
            mock_conv_result = MagicMock()
            mock_conv_result.fetchone.return_value = ("conv-1", "chat", [])
            
            # 模拟 Credits 不足
            mock_credits_result = MagicMock()
            mock_credits_result.fetchone.return_value = (0,)  # 0 Credits
            
            mock_conn.execute.side_effect = [mock_conv_result, mock_credits_result]
            mock_engine.begin.return_value.__aenter__.return_value = mock_conn

            with patch("app.ai.check_credits", return_value=False):
                body = SendMessageRequest(content="Hello")
                
                with pytest.raises(HTTPException) as exc_info:
                    await send_message("conv-1", body, auth=mock_user_auth)
                
                assert exc_info.value.status_code == 402
                assert exc_info.value.detail == "insufficient_credits"


# ============================================================================
# Admin AI API Tests
# ============================================================================


class TestAdminAIModelsAPI:
    """Admin AI 模型管理 API 测试"""

    @pytest.mark.asyncio
    async def test_list_ai_models(self, mock_admin_auth):
        """测试列出 AI 模型"""
        from app.admin_ai import list_ai_models

        with patch("app.admin_ai.engine") as mock_engine:
            mock_conn = AsyncMock()
            mock_result = MagicMock()
            mock_result.fetchall.return_value = [
                (
                    "model-1",
                    "siliconflow",
                    "test-model",
                    "Test Model",
                    True,
                    None,
                    None,
                    0.001,
                    0.002,
                    8192,
                    True,
                    ["chat"],
                    {},
                    "2024-01-01",
                ),
            ]
            mock_result.scalar.return_value = 1
            mock_conn.execute.return_value = mock_result
            mock_engine.begin.return_value.__aenter__.return_value = mock_conn

            result = await list_ai_models(_=mock_admin_auth)

            assert result["status"] == "success"
            assert len(result["data"]) == 1
            assert result["data"][0]["provider"] == "siliconflow"

    def test_encrypt_decrypt_api_key(self):
        """测试 API Key 加密解密"""
        from app.admin_ai import encrypt_api_key, decrypt_api_key

        original_key = "sk-test-api-key-12345"
        encrypted = encrypt_api_key(original_key)
        decrypted = decrypt_api_key(encrypted)

        assert decrypted == original_key
        assert encrypted != original_key

    def test_mask_api_key(self):
        """测试 API Key 遮蔽"""
        from app.admin_ai import mask_api_key

        assert mask_api_key("sk-1234567890abcdef") == "sk-1********cdef"
        assert mask_api_key("short") == "****"
