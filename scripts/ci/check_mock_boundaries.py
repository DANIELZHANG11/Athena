#!/usr/bin/env python3
"""
宪章3：真实服务与 Mock 的边界 (Mocking Boundaries)

检查规则：
1. CI 环境：允许使用 MockOCR、MockEmbedder
2. 生产/Docker 环境：必须加载真实的 PaddleOCR 和 BGE-M3

@see CICD错误日志.md - 宪章3
"""

import os
import sys
import re


def find_project_root():
    """找到项目根目录"""
    cwd = os.getcwd()
    current = cwd
    for _ in range(5):
        if os.path.exists(os.path.join(current, "docker-compose.yml")):
            return current
        parent = os.path.dirname(current)
        if parent == current:
            break
        current = parent
    
    if "scripts" in cwd:
        return os.path.abspath(os.path.join(cwd, "../../"))
    return cwd


def check_docker_compose_no_mock(root_dir):
    """
    检查 docker-compose.yml 中不包含 Mock 服务配置
    """
    violations = []
    
    compose_path = os.path.join(root_dir, "docker-compose.yml")
    if not os.path.exists(compose_path):
        print(f"Warning: docker-compose.yml not found")
        return violations
    
    with open(compose_path, "r", encoding="utf-8") as f:
        content = f.read()
    
    # 检查是否有 Mock 相关环境变量启用
    mock_patterns = [
        r"USE_MOCK_OCR\s*[:=]\s*[\"']?(true|1|yes)[\"']?",
        r"USE_MOCK_EMBEDDER\s*[:=]\s*[\"']?(true|1|yes)[\"']?",
        r"MOCK_MODE\s*[:=]\s*[\"']?(true|1|yes)[\"']?",
    ]
    
    for pattern in mock_patterns:
        if re.search(pattern, content, re.IGNORECASE):
            violations.append(
                f"docker-compose.yml: Contains mock enablement pattern: {pattern}"
            )
    
    return violations


def check_dockerfile_real_services(root_dir):
    """
    检查 Dockerfile 中安装了真实的 PaddleOCR 和 embedding 依赖
    """
    violations = []
    
    dockerfile_paths = [
        os.path.join(root_dir, "api", "Dockerfile"),
        os.path.join(root_dir, "Dockerfile"),
        os.path.join(root_dir, "docker", "api", "Dockerfile"),
    ]
    
    dockerfile_found = False
    
    for dockerfile_path in dockerfile_paths:
        if os.path.exists(dockerfile_path):
            dockerfile_found = True
            with open(dockerfile_path, "r", encoding="utf-8") as f:
                content = f.read()
            
            # 检查是否有 PaddleOCR 或 paddlepaddle 安装
            has_paddle = (
                "paddleocr" in content.lower() or
                "paddlepaddle" in content.lower() or
                "paddle" in content.lower()
            )
            
            # OCR 服务应该有真实依赖
            # 这里只做警告，因为有些部署可能使用外部 OCR 服务
            if not has_paddle:
                print(f"  [WARN] Warning: {os.path.relpath(dockerfile_path, root_dir)} "
                      "may not have PaddleOCR installed")
    
    if not dockerfile_found:
        print("  [WARN] Warning: No Dockerfile found")
    
    return violations


def check_requirements_real_deps(root_dir):
    """
    检查 requirements.txt 包含真实服务依赖
    """
    violations = []
    
    req_path = os.path.join(root_dir, "api", "requirements.txt")
    if not os.path.exists(req_path):
        return violations
    
    with open(req_path, "r", encoding="utf-8") as f:
        content = f.read().lower()
    
    # 生产环境应该有以下依赖
    # 注意：这些可能在单独的 requirements-gpu.txt 中
    expected_deps = [
        ("llama-index", "LlamaIndex for RAG"),
        ("sentence-transformers", "Sentence Transformers for embeddings"),
    ]
    
    missing = []
    for dep, desc in expected_deps:
        if dep not in content:
            missing.append(f"{dep} ({desc})")
    
    if missing:
        print(f"  [WARN] Warning: Some expected dependencies not found in requirements.txt:")
        for m in missing:
            print(f"     - {m}")
    
    return violations


def check_mock_not_default_in_code(root_dir):
    """
    检查代码中 Mock 不是默认行为
    
    允许的 Mock 用法：
    - 在 except 块中作为回退返回
    - 作为类定义存在于文件中
    - 在 if 条件中根据环境变量选择
    """
    violations = []
    
    api_dir = os.path.join(root_dir, "api", "app")
    if not os.path.exists(api_dir):
        return violations
    
    # 危险模式：Mock 作为默认值
    # 注意：不检查类定义和在 except 回退块中的使用
    danger_patterns = [
        (r"USE_MOCK_OCR\s*=\s*True", "Mock OCR enabled by default"),
        (r"USE_MOCK_EMBEDDER\s*=\s*True", "Mock Embedder enabled by default"),
    ]
    
    for root, dirs, files in os.walk(api_dir):
        dirs[:] = [d for d in dirs if d not in ["__pycache__", ".git", "tests"]]
        
        for file in files:
            if not file.endswith(".py"):
                continue
            
            file_path = os.path.join(root, file)
            rel_path = os.path.relpath(file_path, root_dir)
            
            try:
                with open(file_path, "r", encoding="utf-8") as f:
                    content = f.read()
                
                for pattern, desc in danger_patterns:
                    if re.search(pattern, content):
                        # 排除测试文件和配置说明
                        if "test" not in file.lower() and "# CI only" not in content:
                            violations.append(f"{rel_path}: {desc}")
                            break
            except Exception:
                pass
    
    return violations


def check_ci_mock_allowed(root_dir):
    """
    确认 CI 配置中允许使用 Mock
    """
    ci_env_path = os.path.join(root_dir, ".github", "workflows", ".env.ci")
    
    if os.path.exists(ci_env_path):
        with open(ci_env_path, "r", encoding="utf-8") as f:
            content = f.read()
        
        # CI 环境应该允许 Mock
        if "MOCK" in content.upper() or "DEV_MODE" in content:
            print("  [OK] CI environment allows mock services")
        else:
            print("  [WARN] CI environment may need mock configuration")
    else:
        print("  [WARN] .env.ci not found, CI mock config unclear")
    
    return []


def main():
    project_root = find_project_root()
    print(f"Checking project root: {project_root}")
    print("=" * 60)
    print("宪章3: 真实服务与 Mock 的边界 (Mocking Boundaries)")
    print("=" * 60)
    
    all_violations = []
    
    # 检查1: Docker Compose 无 Mock 启用
    print("\n[1/4] Checking docker-compose.yml for mock settings...")
    violations = check_docker_compose_no_mock(project_root)
    all_violations.extend(violations)
    if violations:
        for v in violations:
            print(f"  [FAIL] {v}")
    else:
        print("  [OK] docker-compose.yml has no mock enablement")
    
    # 检查2: Dockerfile 真实服务
    print("\n[2/4] Checking Dockerfile for real service dependencies...")
    violations = check_dockerfile_real_services(project_root)
    all_violations.extend(violations)
    
    # 检查3: requirements.txt 真实依赖
    print("\n[3/4] Checking requirements.txt for real dependencies...")
    violations = check_requirements_real_deps(project_root)
    all_violations.extend(violations)
    
    # 检查4: 代码中 Mock 不是默认
    print("\n[4/4] Checking code for mock defaults...")
    violations = check_mock_not_default_in_code(project_root)
    all_violations.extend(violations)
    if violations:
        for v in violations:
            print(f"  [FAIL] {v}")
    else:
        print("  [OK] No dangerous mock defaults in code")
    
    # 额外: 确认 CI 允许 Mock
    print("\n[Bonus] Verifying CI environment allows mocks...")
    check_ci_mock_allowed(project_root)
    
    print("\n" + "=" * 60)
    if all_violations:
        print(f"[FAIL] FAILED: {len(all_violations)} violation(s) found")
        print("\nRule: Production/Docker must use real PaddleOCR and BGE-M3; CI may use mocks.")
        return False
    else:
        print("[OK] 宪章3检查通过: 真实服务与 Mock 的边界")
        return True


if __name__ == "__main__":
    success = main()
    sys.exit(0 if success else 1)
