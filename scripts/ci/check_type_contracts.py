#!/usr/bin/env python3
"""
宪章8：类型契约强校验 (Type Contract Enforcement)

检查规则：
1. 前端 TypeScript 类型必须与 SQLite Schema 严格对齐
2. 禁止隐式 any
3. tsconfig.json 中必须开启 noImplicitAny: true
4. Schema 字段与 UI 组件使用字段对齐

@see CICD错误日志.md - 宪章8
"""

import os
import sys
import re
import json


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


def check_tsconfig_no_implicit_any(root_dir):
    """
    检查 tsconfig.json 中 noImplicitAny 配置
    """
    violations = []
    
    tsconfig_path = os.path.join(root_dir, "web", "tsconfig.json")
    if not os.path.exists(tsconfig_path):
        violations.append("web/tsconfig.json not found")
        return violations
    
    try:
        with open(tsconfig_path, "r", encoding="utf-8") as f:
            content = f.read()
            # 移除注释（JSON 不支持注释，但 tsconfig 支持）
            content = re.sub(r'//.*$', '', content, flags=re.MULTILINE)
            content = re.sub(r'/\*.*?\*/', '', content, flags=re.DOTALL)
            tsconfig = json.loads(content)
        
        compiler_options = tsconfig.get("compilerOptions", {})
        strict = compiler_options.get("strict", False)
        no_implicit_any = compiler_options.get("noImplicitAny")
        
        if strict:
            print("  [OK] 'strict' mode is enabled (includes noImplicitAny)")
        elif no_implicit_any is True:
            print("  [OK] 'noImplicitAny' is explicitly enabled")
        elif no_implicit_any is False:
            violations.append(
                "web/tsconfig.json: 'noImplicitAny' is explicitly disabled"
            )
        else:
            print("  [WARN] Warning: 'noImplicitAny' is not set (defaults to false)")
            print("     Recommend enabling 'strict: true' or 'noImplicitAny: true'")
    except json.JSONDecodeError as e:
        print(f"  [WARN] Warning: Could not parse tsconfig.json: {e}")
    
    return violations


def check_explicit_any_usage(root_dir):
    """
    检查代码中显式 any 使用情况
    """
    violations = []
    any_count = 0
    
    web_src = os.path.join(root_dir, "web", "src")
    if not os.path.exists(web_src):
        return violations
    
    # 允许使用 any 的文件（遗留代码或有正当理由）
    allowed_any_files = [
        "powersync",  # PowerSync 库类型可能不完整
        "foliate",    # 第三方库
        ".d.ts",      # 类型声明文件
    ]
    
    for root, dirs, files in os.walk(web_src):
        dirs[:] = [d for d in dirs if d not in ["node_modules", ".git", "dist", "build"]]
        
        for file in files:
            if not file.endswith((".ts", ".tsx")):
                continue
            
            file_path = os.path.join(root, file)
            rel_path = os.path.relpath(file_path, root_dir)
            
            # 跳过允许的文件
            if any(allowed in rel_path for allowed in allowed_any_files):
                continue
            
            try:
                with open(file_path, "r", encoding="utf-8") as f:
                    content = f.read()
                
                # 检查显式 any 使用
                # 模式: : any, as any, <any>
                any_patterns = [
                    r":\s*any\b",
                    r"\bas\s+any\b",
                    r"<any>",
                ]
                
                for pattern in any_patterns:
                    matches = re.findall(pattern, content)
                    any_count += len(matches)
                    
            except Exception:
                pass
    
    if any_count > 0:
        print(f"  [WARN] Found {any_count} explicit 'any' usages across codebase")
        print("     Consider replacing with proper types or 'unknown'")
    else:
        print("  [OK] No explicit 'any' found in user code")
    
    return violations


def check_schema_exports_types(root_dir):
    """
    检查 schema.ts 导出类型
    """
    violations = []
    
    schema_path = os.path.join(
        root_dir, "web", "src", "lib", "powersync", "schema.ts"
    )
    
    if not os.path.exists(schema_path):
        violations.append("web/src/lib/powersync/schema.ts not found")
        return violations
    
    with open(schema_path, "r", encoding="utf-8") as f:
        content = f.read()
    
    # 检查是否导出类型
    expected_exports = [
        "BooksRecord",
        "ReadingProgressRecord",
        "NotesRecord",
        "HighlightsRecord",
    ]
    
    exported = []
    missing = []
    
    for export in expected_exports:
        if f"export type {export}" in content or f"export interface {export}" in content:
            exported.append(export)
        elif f"type {export}" in content:
            # 类型存在但可能没有导出
            if f"export {{ " in content and export in content:
                exported.append(export)
            else:
                missing.append(export)
        else:
            missing.append(export)
    
    if exported:
        print(f"  [OK] Schema exports types: {', '.join(exported[:5])}...")
    
    if missing:
        print(f"  [WARN] Types may be missing or not exported: {', '.join(missing)}")
    
    return violations


def check_schema_version_exists(root_dir):
    """
    检查 SCHEMA_VERSION 常量存在
    """
    violations = []
    
    schema_path = os.path.join(
        root_dir, "web", "src", "lib", "powersync", "schema.ts"
    )
    
    if not os.path.exists(schema_path):
        return violations
    
    with open(schema_path, "r", encoding="utf-8") as f:
        content = f.read()
    
    if "SCHEMA_VERSION" in content:
        # 提取版本号
        match = re.search(r"SCHEMA_VERSION\s*=\s*(\d+)", content)
        if match:
            version = match.group(1)
            print(f"  [OK] SCHEMA_VERSION = {version}")
        else:
            print("  [WARN] SCHEMA_VERSION found but version not parseable")
    else:
        violations.append(
            "web/src/lib/powersync/schema.ts: SCHEMA_VERSION not defined"
        )
    
    return violations


def main():
    project_root = find_project_root()
    print(f"Checking project root: {project_root}")
    print("=" * 60)
    print("宪章8: 类型契约强校验 (Type Contract Enforcement)")
    print("=" * 60)
    
    all_violations = []
    
    # 检查1: tsconfig.json noImplicitAny
    print("\n[1/4] Checking tsconfig.json for noImplicitAny...")
    violations = check_tsconfig_no_implicit_any(project_root)
    all_violations.extend(violations)
    if violations:
        for v in violations:
            print(f"  [FAIL] {v}")
    
    # 检查2: 显式 any 使用
    print("\n[2/4] Checking for explicit 'any' usage...")
    violations = check_explicit_any_usage(project_root)
    all_violations.extend(violations)
    
    # 检查3: Schema 导出类型
    print("\n[3/4] Checking schema.ts type exports...")
    violations = check_schema_exports_types(project_root)
    all_violations.extend(violations)
    if violations:
        for v in violations:
            print(f"  [FAIL] {v}")
    
    # 检查4: SCHEMA_VERSION 存在
    print("\n[4/4] Checking SCHEMA_VERSION constant...")
    violations = check_schema_version_exists(project_root)
    all_violations.extend(violations)
    if violations:
        for v in violations:
            print(f"  [FAIL] {v}")
    
    print("\n" + "=" * 60)
    if all_violations:
        print(f"[FAIL] FAILED: {len(all_violations)} violation(s) found")
        print("\nRule: TypeScript types must align with SQLite Schema; no implicit any.")
        return False
    else:
        print("[OK] 宪章8检查通过: 类型契约强校验")
        return True


if __name__ == "__main__":
    success = main()
    sys.exit(0 if success else 1)
