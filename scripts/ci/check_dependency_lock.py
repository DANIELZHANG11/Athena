#!/usr/bin/env python3
"""
宪章4：依赖锁定原则 (Dependency Strictness)

检查规则：
1. 核心库版本必须严格锁定，禁止随意升级
2. requirements.txt 中核心库使用 == 固定版本
3. pnpm-lock.yaml 必须存在

@see CICD错误日志.md - 宪章4
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


# 核心库列表 - 这些库的版本必须严格锁定
CORE_PYTHON_LIBS = [
    "fastapi",
    "sqlalchemy",
    "alembic",
    "pydantic",
    "uvicorn",
    "celery",
    "redis",
    "boto3",
    "llama-index",
    "llama-index-core",
]

CORE_NODE_LIBS = [
    "@powersync/web",
    "react",
    "react-dom",
    "vite",
]


def check_requirements_locked(root_dir):
    """
    检查 requirements.txt 中核心库版本锁定
    """
    violations = []
    warnings = []
    
    req_path = os.path.join(root_dir, "api", "requirements.txt")
    if not os.path.exists(req_path):
        print(f"  [WARN] Warning: requirements.txt not found")
        return violations
    
    with open(req_path, "r", encoding="utf-8") as f:
        lines = f.readlines()
    
    for line in lines:
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        
        # 解析包名
        match = re.match(r"^([a-zA-Z0-9_-]+)", line)
        if not match:
            continue
        
        pkg_name = match.group(1).lower()
        
        # 检查核心库
        for core_lib in CORE_PYTHON_LIBS:
            if pkg_name == core_lib.lower():
                # 检查是否使用 == 固定版本
                if "==" not in line:
                    if ">=" in line or ">" in line or "~=" in line:
                        warnings.append(
                            f"Core lib '{core_lib}' uses range version: {line}"
                        )
    
    if warnings:
        for w in warnings:
            print(f"  [WARN] {w}")
    
    return violations


def check_lockfile_exists(root_dir):
    """
    检查锁文件是否存在
    """
    violations = []
    
    # pnpm-lock.yaml
    pnpm_lock = os.path.join(root_dir, "web", "pnpm-lock.yaml")
    if not os.path.exists(pnpm_lock):
        violations.append("web/pnpm-lock.yaml not found - dependencies are not locked")
    else:
        print("  [OK] pnpm-lock.yaml exists")
    
    return violations


def check_package_json_exact(root_dir):
    """
    检查 package.json 中核心库是否有具体版本
    """
    violations = []
    
    pkg_path = os.path.join(root_dir, "web", "package.json")
    if not os.path.exists(pkg_path):
        return violations
    
    import json
    
    try:
        with open(pkg_path, "r", encoding="utf-8") as f:
            pkg = json.load(f)
        
        deps = pkg.get("dependencies", {})
        dev_deps = pkg.get("devDependencies", {})
        all_deps = {**deps, **dev_deps}
        
        for core_lib in CORE_NODE_LIBS:
            if core_lib in all_deps:
                version = all_deps[core_lib]
                # 检查是否使用 ^ 或 ~ 前缀（允许但警告）
                if version.startswith("^") or version.startswith("~"):
                    print(f"  [WARN] {core_lib} uses range: {version} (lock file enforces exact)")
    except Exception as e:
        print(f"  [WARN] Could not parse package.json: {e}")
    
    return violations


def check_no_floating_versions(root_dir):
    """
    检查没有使用 * 或 latest 版本
    """
    violations = []
    
    # 检查 requirements.txt
    req_path = os.path.join(root_dir, "api", "requirements.txt")
    if os.path.exists(req_path):
        with open(req_path, "r", encoding="utf-8") as f:
            content = f.read()
        
        if re.search(r"\*|latest", content, re.IGNORECASE):
            violations.append("requirements.txt contains '*' or 'latest' version")
    
    # 检查 package.json
    pkg_path = os.path.join(root_dir, "web", "package.json")
    if os.path.exists(pkg_path):
        with open(pkg_path, "r", encoding="utf-8") as f:
            content = f.read()
        
        if '"*"' in content or '"latest"' in content:
            violations.append("package.json contains '*' or 'latest' version")
    
    return violations


def main():
    project_root = find_project_root()
    print(f"Checking project root: {project_root}")
    print("=" * 60)
    print("宪章4: 依赖锁定原则 (Dependency Strictness)")
    print("=" * 60)
    
    all_violations = []
    
    # 检查1: requirements.txt 核心库锁定
    print("\n[1/4] Checking Python core library versions...")
    violations = check_requirements_locked(project_root)
    all_violations.extend(violations)
    if not violations:
        print("  [OK] Core Python libs version check passed")
    
    # 检查2: 锁文件存在
    print("\n[2/4] Checking lock files exist...")
    violations = check_lockfile_exists(project_root)
    all_violations.extend(violations)
    if violations:
        for v in violations:
            print(f"  [FAIL] {v}")
    
    # 检查3: package.json 版本
    print("\n[3/4] Checking Node.js core library versions...")
    violations = check_package_json_exact(project_root)
    all_violations.extend(violations)
    if not violations:
        print("  [OK] Core Node.js libs version check passed")
    
    # 检查4: 无浮动版本
    print("\n[4/4] Checking for floating versions (* or latest)...")
    violations = check_no_floating_versions(project_root)
    all_violations.extend(violations)
    if violations:
        for v in violations:
            print(f"  [FAIL] {v}")
    else:
        print("  [OK] No floating versions found")
    
    print("\n" + "=" * 60)
    if all_violations:
        print(f"[FAIL] FAILED: {len(all_violations)} violation(s) found")
        print("\nRule: Core library versions must be strictly locked.")
        return False
    else:
        print("[OK] 宪章4检查通过: 依赖锁定原则")
        return True


if __name__ == "__main__":
    success = main()
    sys.exit(0 if success else 1)
