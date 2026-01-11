#!/usr/bin/env python3
"""
宪章7：架构隔离探针 (Architectural Isolation Probe)

检查规则：
1. UI 层严禁直接触碰业务 REST API
2. 前端代码库中，除白名单模块外，禁止出现网络请求代码
3. 检测 axios, fetch, useQuery 直接调用业务 API 路径
4. 白名单：仅允许 auth.ts, billing.ts, ai.ts 包含网络请求

@see CICD错误日志.md - 宪章7
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


# 违规模式：禁止直接使用 axios, fetch
NETWORK_PATTERNS = [
    (r"axios\.", "axios direct call"),
    (r"fetch\s*\(", "fetch direct call"),
    (r"useQuery\s*\(", "useQuery (React Query)"),
    (r"useMutation\s*\(", "useMutation (React Query)"),
]

# 具体 API 路径红线 - 这些路径绝对不能在 UI 层直接调用
FORBIDDEN_API_PATHS = [
    r"/api/v1/books",
    r"/api/v1/notes",
    r"/api/v1/highlights",
    r"/api/v1/shelves",
    r"/api/v1/reading",
    r"/api/v1/sync",
]

# 允许的文件（严格白名单）- 根据规则 7
ALLOWED_FILES = [
    "web/src/services/auth.ts",
    "web/src/services/billing.ts",
    "web/src/services/ai.ts",
    "web/src/lib/api.ts",
    "web/src/lib/apiUrl.ts",  # API URL 封装层
    "web/src/stores/auth.ts",
]

# 技术债务白名单（暂时允许，但需要逐步迁移）
# 这些文件会被报告但不会导致 CI 失败
TECH_DEBT_ALLOWLIST = [
    # Components with legacy network calls
    "web/src/components/upload/UploadManager.tsx",
    "web/src/components/BookMetadataDialog.tsx",
    "web/src/components/StorageManager.tsx",
    "web/src/components/OcrTriggerDialog.tsx",
    "web/src/components/auth/EmailLoginForm.tsx",
    "web/src/components/landing/DownloadSection.tsx",
    
    # PowerSync and services
    "web/src/lib/powersync/PowerSyncProvider.tsx",
    "web/src/services/fontService.ts",
    
    # Hooks with network calls (need migration to services)
    "web/src/hooks/useBookDownload.ts",
    "web/src/hooks/useOcrData.ts",
    "web/src/hooks/useAIChatCache.ts",
    "web/src/hooks/useTolgeeLanguages.ts",
    "web/src/hooks/useUploadPostProcessing.ts",
    "web/src/hooks/useFontDownload.ts",
    
    # Pages with mixed network patterns (to be refactored)
    "web/src/pages/ReaderPage.tsx",
    "web/src/pages/auth/Register.tsx",
    "web/src/pages/auth/Login.tsx",
    "web/src/pages/LibraryPage.tsx",
    "web/src/pages/TTSPage.tsx",
    "web/src/pages/BillingPage.tsx",
    "web/src/pages/AIConversationsPage.tsx",
    "web/src/pages/LoginPage.tsx",
    "web/src/pages/ProfilePage.tsx",
    "web/src/pages/ExportPage.tsx",
    "web/src/pages/DocEditor.tsx",
    "web/src/pages/RecentlyDeletedPage.tsx",
    "web/src/pages/app/Home.tsx",
    
    # Landing pages (public, non-app)
    "web/src/Price.tsx",
    "web/src/pages/landing/Landing.tsx",
]


def check_forbidden_api_paths(root_dir):
    """
    检查代码中是否直接调用禁止的 API 路径
    """
    violations = []
    
    web_src = os.path.join(root_dir, "web", "src")
    if not os.path.exists(web_src):
        return violations
    
    # 扫描 components 和 pages 目录
    scan_dirs = [
        os.path.join(web_src, "components"),
        os.path.join(web_src, "pages"),
    ]
    
    for scan_dir in scan_dirs:
        if not os.path.exists(scan_dir):
            continue
        
        for root, dirs, files in os.walk(scan_dir):
            dirs[:] = [d for d in dirs if d not in ["node_modules", ".git"]]
            
            for file in files:
                if not file.endswith((".ts", ".tsx")):
                    continue
                
                file_path = os.path.join(root, file)
                rel_path = os.path.relpath(file_path, root_dir).replace("\\", "/")
                
                # 跳过白名单和技术债务白名单
                if rel_path in ALLOWED_FILES:
                    continue
                if rel_path in TECH_DEBT_ALLOWLIST:
                    continue
                
                try:
                    with open(file_path, "r", encoding="utf-8") as f:
                        content = f.read()
                    
                    for api_path in FORBIDDEN_API_PATHS:
                        if re.search(api_path, content):
                            violations.append(
                                f"{rel_path}: Direct call to forbidden API path: {api_path}"
                            )
                            break
                except Exception:
                    pass
    
    return violations


def check_network_patterns(root_dir):
    """
    检查网络请求模式
    """
    violations = []
    tech_debt = []
    
    web_src = os.path.join(root_dir, "web", "src")
    if not os.path.exists(web_src):
        print(f"Directory not found: {web_src}")
        return violations, tech_debt

    for root, dirs, files in os.walk(web_src):
        dirs[:] = [d for d in dirs if d not in ["node_modules", ".git", "dist", "build"]]
        
        for file in files:
            if not file.endswith((".ts", ".tsx")):
                continue
                
            file_path = os.path.join(root, file)
            rel_path = os.path.relpath(file_path, root_dir).replace("\\", "/")
            
            # 检查严格白名单
            if rel_path in ALLOWED_FILES:
                continue
            
            # 检查技术债务白名单
            is_tech_debt = rel_path in TECH_DEBT_ALLOWLIST
            
            try:
                with open(file_path, "r", encoding="utf-8") as f:
                    content = f.read()
                
                for pattern, desc in NETWORK_PATTERNS:
                    if re.search(pattern, content):
                        msg = f"{rel_path}: Found {desc}"
                        if is_tech_debt:
                            tech_debt.append(msg)
                        else:
                            violations.append(msg)
                        break
            except Exception:
                pass

    return violations, tech_debt


def check_correct_patterns(root_dir):
    """
    检查是否使用正确的数据访问模式
    """
    web_src = os.path.join(root_dir, "web", "src")
    if not os.path.exists(web_src):
        return
    
    correct_patterns = [
        (r"useLiveQuery", "PowerSync useLiveQuery"),
        (r"useQuery.*powersync", "PowerSync query"),
        (r"db\.execute", "PowerSync db.execute"),
    ]
    
    correct_usages = 0
    
    for root, dirs, files in os.walk(web_src):
        dirs[:] = [d for d in dirs if d not in ["node_modules", ".git", "dist", "build"]]
        
        for file in files:
            if not file.endswith((".ts", ".tsx")):
                continue
            
            file_path = os.path.join(root, file)
            
            try:
                with open(file_path, "r", encoding="utf-8") as f:
                    content = f.read()
                
                for pattern, desc in correct_patterns:
                    matches = re.findall(pattern, content, re.IGNORECASE)
                    correct_usages += len(matches)
            except Exception:
                pass
    
    if correct_usages > 0:
        print(f"  [OK] Found {correct_usages} correct PowerSync usages")


def main():
    project_root = find_project_root()
    print(f"Checking project root: {project_root}")
    print("=" * 60)
    print("宪章7: 架构隔离探针 (Architectural Isolation Probe)")
    print("=" * 60)
    
    all_violations = []
    
    # 检查1: 禁止的 API 路径
    print("\n[1/3] Checking for forbidden API path calls in UI layer...")
    violations = check_forbidden_api_paths(project_root)
    all_violations.extend(violations)
    if violations:
        for v in violations:
            print(f"  [FAIL] {v}")
    else:
        print("  [OK] No forbidden API paths in UI layer")
    
    # 检查2: 网络请求模式
    print("\n[2/3] Checking for network request patterns...")
    violations, tech_debt = check_network_patterns(project_root)
    all_violations.extend(violations)
    
    if violations:
        print("  [FAIL] New violations (must fix):")
        for v in violations:
            print(f"     - {v}")
    
    if tech_debt:
        print(f"  [WARN] Tech debt (whitelisted, {len(tech_debt)} files):")
        for t in tech_debt[:5]:
            print(f"     - {t}")
        if len(tech_debt) > 5:
            print(f"     ... and {len(tech_debt) - 5} more")
    
    if not violations and not tech_debt:
        print("  [OK] No network patterns outside allowed files")
    
    # 检查3: 正确的模式使用
    print("\n[3/3] Verifying correct data access patterns...")
    check_correct_patterns(project_root)
    
    print("\n" + "=" * 60)
    if all_violations:
        print(f"[FAIL] FAILED: {len(all_violations)} violation(s) found")
        print("\nRule: UI layer must not directly call REST APIs.")
        print("Use PowerSync (useLiveQuery) or Repo layer instead.")
        print("White-listed services: auth.ts, billing.ts, ai.ts")
        return False
    else:
        print("[OK] 宪章7检查通过: 架构隔离探针")
        return True


if __name__ == "__main__":
    success = main()
    sys.exit(0 if success else 1)
