import os
import sys
import re

# 违规模式：禁止直接使用 axios, fetch
# 允许的例外：使用 PowerSync, 或在特定 Service 文件中
PATTERNS = [
    r"axios\.",
    r"fetch\(",
    r"useQuery\(", # React Query，如果直接跟 URL 也是违规，但这里简单检查
]

# 允许的文件（白名单）- 根据规则 7
ALLOWED_FILES = [
    "web/src/services/auth.ts",
    "web/src/services/billing.ts",
    "web/src/services/ai.ts",
    "web/src/lib/api.ts", # 现有的 API 封装
    "web/src/stores/auth.ts", # 现有的 Auth Store
]

# 技术债务白名单（暂时允许，但需要逐步迁移）
TECH_DEBT_ALLOWLIST = [
    "web/src/components/upload/UploadManager.tsx",
    "web/src/components/BookMetadataDialog.tsx",
    "web/src/components/StorageManager.tsx",
    "web/src/components/OcrTriggerDialog.tsx",
    "web/src/lib/powersync/PowerSyncProvider.tsx",
    "web/src/hooks/useBookDownload.ts",
    "web/src/hooks/useOcrData.ts",
    "web/src/hooks/useAIChatCache.ts",
    "web/src/hooks/useTolgeeLanguages.ts",
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
    "web/src/Price.tsx",
    "web/src/hooks/useUploadPostProcessing.ts",
]

def check_architecture(root_dir):
    violations = []
    
    web_root = os.path.join(root_dir, "web", "src")
    if not os.path.exists(web_root):
        print(f"Directory not found: {web_root}")
        return False

    for root, dirs, files in os.walk(web_root):
        for file in files:
            if not file.endswith((".ts", ".tsx")):
                continue
                
            file_path = os.path.join(root, file)
            rel_path = os.path.relpath(file_path, root_dir).replace("\\", "/")
            
            # 检查白名单
            if rel_path in ALLOWED_FILES:
                continue
            if rel_path in TECH_DEBT_ALLOWLIST:
                continue
                
            with open(file_path, "r", encoding="utf-8") as f:
                content = f.read()
                for pattern in PATTERNS:
                    if re.search(pattern, content):
                        # 排除注释
                        # 这里做一个简单的检查，如果整行都是注释则忽略，但行内注释比较难
                        # 简单起见，如果匹配到了就报错，鼓励开发者不要在非 Service 层写这些
                        violations.append(f"{rel_path}: Found restricted pattern '{pattern}'")
                        break # 一个文件报一次即可

    if violations:
        print("Architecture Violations Found:")
        for v in violations:
            print(f"  - {v}")
        print("\nRule: Direct network calls (axios, fetch) are restricted to Service layers.")
        print("Please move logic to web/src/services/ or add to whitelist if absolutely necessary.")
        return False
    
    print("Architecture check passed.")
    return True

if __name__ == "__main__":
    # Assume script is run from project root or scripts/ci
    cwd = os.getcwd()
    if os.path.basename(cwd) == "ci": # inside scripts/ci
        project_root = os.path.dirname(os.path.dirname(cwd))
    elif os.path.basename(cwd) == "scripts":
        project_root = os.path.dirname(cwd)
    else:
        project_root = cwd
        
    success = check_architecture(project_root)
    sys.exit(0 if success else 1)
