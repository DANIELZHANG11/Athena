#!/usr/bin/env python3
"""
宪章1：架构降级零容忍 (No Architectural Regression)

检查规则：
1. 严禁移除数据库事务中的 FOR UPDATE 锁
2. 严禁移除原子更新（Atomic Update）逻辑
3. 必须在同一事务中完成计费扣除与业务写入
4. 严禁在 PowerSync 的 sync_rules.yaml 中使用开放式查询（如 SELECT *）

@see CICD错误日志.md - 宪章1
"""

import os
import sys
import re


def find_project_root():
    """找到项目根目录"""
    cwd = os.getcwd()
    # 尝试向上查找包含 docker-compose.yml 的目录
    current = cwd
    for _ in range(5):
        if os.path.exists(os.path.join(current, "docker-compose.yml")):
            return current
        parent = os.path.dirname(current)
        if parent == current:
            break
        current = parent
    
    # 回退逻辑
    if "scripts" in cwd:
        return os.path.abspath(os.path.join(cwd, "../../"))
    return cwd


def check_for_update_locks(root_dir):
    """
    检查计费相关代码中的数据一致性保护
    
    原子更新模式（如 balance = balance - :amt）是合规的，
    因为这在单条SQL语句中完成，无需额外的FOR UPDATE锁。
    """
    billing_files = [
        os.path.join(root_dir, "api", "app", "billing.py"),
        os.path.join(root_dir, "api", "app", "credits.py"),
    ]
    
    violations = []
    
    for file_path in billing_files:
        if not os.path.exists(file_path):
            continue
        
        with open(file_path, "r", encoding="utf-8") as f:
            content = f.read()
        
        # 检查是否使用原子更新模式 (balance = balance - :amt)
        # 这是正确的做法，无需 FOR UPDATE
        uses_atomic = re.search(r"balance\s*=\s*balance\s*[-+]", content)
        
        if uses_atomic:
            print(f"  [OK] {os.path.relpath(file_path, root_dir)} uses atomic updates (compliant)")
        else:
            # 如果没有原子更新，检查是否有先读后写的危险模式
            # 危险：先 SELECT balance INTO variable，再用 variable 计算
            if "balance" in content.lower():
                danger_pattern = r"SELECT.*balance.*INTO|fetchone\(\).*balance"
                if re.search(danger_pattern, content, re.IGNORECASE):
                    if "FOR UPDATE" not in content:
                        violations.append(
                            f"{os.path.relpath(file_path, root_dir)}: "
                            "Balance read-then-write without FOR UPDATE lock"
                        )
    
    return violations


def check_atomic_updates(root_dir):
    """
    检查是否使用原子更新而非先读后写模式
    """
    violations = []
    
    api_dir = os.path.join(root_dir, "api", "app")
    if not os.path.exists(api_dir):
        return violations
    
    # 危险模式：先读取余额，再减去值，然后写入
    # 这是非原子操作，应该使用 UPDATE ... SET balance = balance - amount
    danger_pattern = re.compile(
        r"(\w+)\s*=\s*.*\.balance.*\n.*\1\s*-=|"
        r"balance\s*=\s*result\.balance\s*-",
        re.MULTILINE
    )
    
    for root, dirs, files in os.walk(api_dir):
        dirs[:] = [d for d in dirs if d not in ["__pycache__", ".git"]]
        
        for file in files:
            if not file.endswith(".py"):
                continue
            
            file_path = os.path.join(root, file)
            
            try:
                with open(file_path, "r", encoding="utf-8") as f:
                    content = f.read()
                
                if danger_pattern.search(content):
                    violations.append(
                        f"{os.path.relpath(file_path, root_dir)}: "
                        "Non-atomic balance update pattern detected"
                    )
            except Exception:
                pass
    
    return violations


def check_sync_rules_no_select_star(root_dir):
    """
    检查 sync_rules.yaml 不使用 SELECT *
    """
    violations = []
    
    sync_rules_path = os.path.join(
        root_dir, "docker", "powersync", "sync_rules.yaml"
    )
    
    if not os.path.exists(sync_rules_path):
        print(f"Warning: sync_rules.yaml not found at {sync_rules_path}")
        return violations
    
    with open(sync_rules_path, "r", encoding="utf-8") as f:
        content = f.read()
    
    # 检查是否有 SELECT * 模式
    if re.search(r"SELECT\s+\*\s+FROM", content, re.IGNORECASE):
        violations.append(
            "docker/powersync/sync_rules.yaml: "
            "Contains 'SELECT *' - must explicitly list fields"
        )
    
    # 检查是否有未列出字段的 SELECT 语句
    # 正常的 SELECT 应该明确列出字段
    
    return violations


def check_transaction_integrity(root_dir):
    """
    检查计费扣除是否在事务中完成
    """
    violations = []
    
    billing_files = [
        os.path.join(root_dir, "api", "app", "billing.py"),
        os.path.join(root_dir, "api", "app", "ai.py"),
    ]
    
    for file_path in billing_files:
        if not os.path.exists(file_path):
            continue
        
        with open(file_path, "r", encoding="utf-8") as f:
            content = f.read()
        
        # 如果有扣费逻辑，必须在 async with session 或 begin() 中
        if "deduct" in content.lower() or "charge" in content.lower():
            # 检查是否有事务上下文
            if "async with" not in content and "begin()" not in content:
                if "session" not in content and "transaction" not in content.lower():
                    violations.append(
                        f"{os.path.relpath(file_path, root_dir)}: "
                        "Deduction logic may not be in transaction context"
                    )
    
    return violations


def main():
    project_root = find_project_root()
    print(f"Checking project root: {project_root}")
    print("=" * 60)
    print("宪章1: 架构降级零容忍 (No Architectural Regression)")
    print("=" * 60)
    
    all_violations = []
    
    # 检查1: FOR UPDATE 锁
    print("\n[1/4] Checking FOR UPDATE locks in billing code...")
    violations = check_for_update_locks(project_root)
    all_violations.extend(violations)
    if violations:
        for v in violations:
            print(f"  [FAIL] {v}")
    else:
        print("  [OK] FOR UPDATE lock check passed")
    
    # 检查2: 原子更新
    print("\n[2/4] Checking atomic update patterns...")
    violations = check_atomic_updates(project_root)
    all_violations.extend(violations)
    if violations:
        for v in violations:
            print(f"  [FAIL] {v}")
    else:
        print("  [OK] Atomic update check passed")
    
    # 检查3: sync_rules.yaml 无 SELECT *
    print("\n[3/4] Checking sync_rules.yaml for SELECT *...")
    violations = check_sync_rules_no_select_star(project_root)
    all_violations.extend(violations)
    if violations:
        for v in violations:
            print(f"  [FAIL] {v}")
    else:
        print("  [OK] sync_rules.yaml check passed")
    
    # 检查4: 事务完整性
    print("\n[4/4] Checking transaction integrity for billing...")
    violations = check_transaction_integrity(project_root)
    all_violations.extend(violations)
    if violations:
        for v in violations:
            print(f"  [FAIL] {v}")
    else:
        print("  [OK] Transaction integrity check passed")
    
    print("\n" + "=" * 60)
    if all_violations:
        print(f"[FAIL] FAILED: {len(all_violations)} violation(s) found")
        print("\nRule: Never remove FOR UPDATE locks, atomic updates, or use SELECT * in sync rules.")
        return False
    else:
        print("[OK] 宪章1检查通过: 架构降级零容忍")
        return True


if __name__ == "__main__":
    success = main()
    sys.exit(0 if success else 1)
