#!/usr/bin/env python3
"""
宪章2：DDL 迁移圣洁性 (Migration Sanctity)

检查规则：
1. 数据库结构的任何变更必须通过 Alembic 迁移脚本完成
2. 严禁在业务代码中执行 CREATE/ALTER TABLE
3. 严禁使用 if not exists 偷懒
4. 前端的 SQLite Schema 变更必须包含版本号注释或迁移日志

@see CICD错误日志.md - 宪章2
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


def check_schema_version(root_dir):
    """
    检查前端 Schema 版本号
    """
    violations = []
    
    schema_path = os.path.join(root_dir, "web", "src", "lib", "powersync", "schema.ts")
    if not os.path.exists(schema_path):
        violations.append(f"Schema file not found: web/src/lib/powersync/schema.ts")
        return violations
        
    with open(schema_path, "r", encoding="utf-8") as f:
        content = f.read()
        
    if "SCHEMA_VERSION" not in content:
        violations.append(
            "web/src/lib/powersync/schema.ts does not export SCHEMA_VERSION"
        )
        return violations
    
    # 提取版本号
    match = re.search(r"SCHEMA_VERSION\s*=\s*(\d+)", content)
    if match:
        version = match.group(1)
        print(f"  [OK] SCHEMA_VERSION = {version}")
    else:
        print("  [WARN] SCHEMA_VERSION found but value not parseable")
        
    return violations


def check_ddl_sanctity(root_dir):
    """
    检查业务代码中禁止的 DDL 语句
    """
    violations = []
    
    # 禁止的 DDL 模式
    forbidden_patterns = [
        (r"CREATE\s+TABLE", "CREATE TABLE"),
        (r"ALTER\s+TABLE", "ALTER TABLE"),
        (r"DROP\s+TABLE", "DROP TABLE"),
    ]
    
    # 排除的目录和文件
    exclude_patterns = [
        ".git",
        "node_modules",
        "__pycache__",
        ".venv",
        "venv",
        "env",
        "dist",
        "build",
        "coverage",
        "android",
        "ios",
        "api/alembic",  # Alembic 迁移脚本允许
        "api/migrations",
        "check_schema.py",
        "apply_v9_schema.py",
        "sync_rules.yaml",
        "schema.ts",  # Schema 定义文件允许
        "powersync.js",
        "index.js",
    ]
    
    for root, dirs, files in os.walk(root_dir):
        # 过滤目录
        dirs[:] = [d for d in dirs if d not in exclude_patterns and not d.startswith('.')]
        
        rel_root = os.path.relpath(root, root_dir).replace("\\", "/")
        if any(ex in rel_root.split("/") for ex in exclude_patterns):
            continue

        for file in files:
            if file.endswith((".py", ".ts", ".tsx", ".js", ".sql")):
                if file in exclude_patterns:
                    continue
                
                # 跳过构建产物
                if ".min." in file or any(h in file for h in ["-DLPwgLDN", "-tMoVcbjN"]):
                    continue

                file_path = os.path.join(root, file)
                rel_path = os.path.relpath(file_path, root_dir).replace("\\", "/")
                
                if any(ex in rel_path for ex in exclude_patterns):
                    continue

                try:
                    with open(file_path, "r", encoding="utf-8", errors='ignore') as f:
                        content = f.read()
                    
                    for pattern, desc in forbidden_patterns:
                        if re.search(pattern, content, re.IGNORECASE):
                            violations.append(f"{rel_path}: Contains forbidden DDL '{desc}'")
                            break
                except Exception:
                    pass
                    
    return violations


def check_if_not_exists(root_dir):
    """
    检查禁止使用的 IF NOT EXISTS 偷懒模式
    """
    violations = []
    
    api_dir = os.path.join(root_dir, "api", "app")
    if not os.path.exists(api_dir):
        return violations
    
    for root, dirs, files in os.walk(api_dir):
        dirs[:] = [d for d in dirs if d not in ["__pycache__", "alembic", "migrations"]]
        
        for file in files:
            if not file.endswith(".py"):
                continue
            
            file_path = os.path.join(root, file)
            rel_path = os.path.relpath(file_path, root_dir)
            
            try:
                with open(file_path, "r", encoding="utf-8") as f:
                    content = f.read()
                
                # 检查 IF NOT EXISTS
                if re.search(r"IF\s+NOT\s+EXISTS", content, re.IGNORECASE):
                    # 排除注释
                    lines = content.split("\n")
                    for i, line in enumerate(lines, 1):
                        if re.search(r"IF\s+NOT\s+EXISTS", line, re.IGNORECASE):
                            stripped = line.strip()
                            if not stripped.startswith("#") and not stripped.startswith("//"):
                                violations.append(
                                    f"{rel_path}:{i}: Uses 'IF NOT EXISTS' - use Alembic migration instead"
                                )
                                break
            except Exception:
                pass
    
    return violations


def main():
    project_root = find_project_root()
    print(f"Checking project root: {project_root}")
    print("=" * 60)
    print("宪章2: DDL 迁移圣洁性 (Migration Sanctity)")
    print("=" * 60)
    
    all_violations = []
    
    # 检查1: Schema 版本号
    print("\n[1/3] Checking frontend Schema version...")
    violations = check_schema_version(project_root)
    all_violations.extend(violations)
    if violations:
        for v in violations:
            print(f"  [FAIL] {v}")
    
    # 检查2: DDL 语句
    print("\n[2/3] Checking for forbidden DDL in business code...")
    violations = check_ddl_sanctity(project_root)
    all_violations.extend(violations)
    if violations:
        for v in violations:
            print(f"  [FAIL] {v}")
    else:
        print("  [OK] No forbidden DDL in business code")
    
    # 检查3: IF NOT EXISTS
    print("\n[3/3] Checking for 'IF NOT EXISTS' anti-pattern...")
    violations = check_if_not_exists(project_root)
    all_violations.extend(violations)
    if violations:
        for v in violations:
            print(f"  [FAIL] {v}")
    else:
        print("  [OK] No 'IF NOT EXISTS' anti-pattern found")
    
    print("\n" + "=" * 60)
    if all_violations:
        print(f"[FAIL] FAILED: {len(all_violations)} violation(s) found")
        print("\nRule: Database structure changes must be done via Alembic migrations.")
        print("Frontend schema changes must update SCHEMA_VERSION.")
        return False
    else:
        print("[OK] 宪章2检查通过: DDL 迁移圣洁性")
        return True


if __name__ == "__main__":
    success = main()
    sys.exit(0 if success else 1)
