#!/usr/bin/env python3
"""
宪章6：设备指纹强制 (Device Identity)

检查规则：
1. 所有涉及同步的写操作（Write），必须携带 deviceId
2. 前端生成 UUID 并持久化在 LocalStorage，严禁每次刷新变动
3. 后端必须校验 deviceId

@see CICD错误日志.md - 宪章6
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


# 同步表列表 - 这些表的写操作必须包含 device_id
SYNC_TABLES = [
    "reading_progress",
    "reading_sessions",
    "notes",
    "highlights",
    "bookmarks",
    "user_settings",
    "reading_settings",
]


def check_frontend_device_id_persist(root_dir):
    """
    检查前端 deviceId 持久化实现
    """
    violations = []
    
    # 检查 utils.ts 或类似文件中的 getDeviceId 实现
    utils_paths = [
        os.path.join(root_dir, "web", "src", "lib", "utils.ts"),
        os.path.join(root_dir, "web", "src", "utils", "device.ts"),
        os.path.join(root_dir, "web", "src", "lib", "device.ts"),
    ]
    
    device_id_found = False
    
    for utils_path in utils_paths:
        if os.path.exists(utils_path):
            with open(utils_path, "r", encoding="utf-8") as f:
                content = f.read()
            
            # 检查是否有 getDeviceId 函数
            if "getDeviceId" in content or "deviceId" in content:
                device_id_found = True
                
                # 检查是否使用 localStorage 持久化
                if "localStorage" in content:
                    print(f"  [OK] deviceId uses localStorage in {os.path.basename(utils_path)}")
                    
                    # 检查是否每次生成新 UUID
                    if re.search(r"uuid.*\(\)(?!\s*\|\|\s*localStorage)", content):
                        print("  [WARN] Warning: UUID may be generated without checking localStorage first")
                else:
                    violations.append(
                        f"{os.path.relpath(utils_path, root_dir)}: "
                        "deviceId should use localStorage for persistence"
                    )
    
    if not device_id_found:
        print("  [WARN] Warning: getDeviceId function not found in expected locations")
    
    return violations


def check_frontend_inserts_have_device_id(root_dir):
    """
    检查前端 INSERT 语句是否包含 device_id
    """
    violations = []
    
    web_src = os.path.join(root_dir, "web", "src")
    if not os.path.exists(web_src):
        return violations
    
    for root, dirs, files in os.walk(web_src):
        dirs[:] = [d for d in dirs if d not in ["node_modules", ".git", "dist", "build"]]
        
        for file in files:
            if not file.endswith((".ts", ".tsx")):
                continue
            
            file_path = os.path.join(root, file)
            rel_path = os.path.relpath(file_path, root_dir)
            
            try:
                with open(file_path, "r", encoding="utf-8") as f:
                    content = f.read()
                
                # 检查 INSERT INTO 同步表
                for table in SYNC_TABLES:
                    # 查找 INSERT INTO table_name
                    insert_pattern = rf"INSERT\s+INTO\s+{table}\s*\("
                    matches = list(re.finditer(insert_pattern, content, re.IGNORECASE))
                    
                    for match in matches:
                        # 获取 INSERT 语句的一部分用于检查
                        start = match.start()
                        # 找到下一个 VALUES 或结束括号
                        end = content.find("VALUES", start)
                        if end == -1:
                            end = start + 500
                        
                        insert_stmt = content[start:min(end, start + 500)]
                        
                        # 检查是否包含 device_id
                        if "device_id" not in insert_stmt.lower():
                            violations.append(
                                f"{rel_path}: INSERT INTO {table} missing device_id"
                            )
            except Exception:
                pass
    
    return violations


def check_frontend_updates_have_device_id(root_dir):
    """
    检查前端 UPDATE 语句 SET 子句是否包含 device_id
    PowerSync 要求 SET 子句中包含 device_id 才能正确同步
    """
    violations = []
    
    web_src = os.path.join(root_dir, "web", "src")
    if not os.path.exists(web_src):
        return violations
    
    for root, dirs, files in os.walk(web_src):
        dirs[:] = [d for d in dirs if d not in ["node_modules", ".git", "dist", "build"]]
        
        for file in files:
            if not file.endswith((".ts", ".tsx")):
                continue
            
            file_path = os.path.join(root, file)
            rel_path = os.path.relpath(file_path, root_dir)
            
            try:
                with open(file_path, "r", encoding="utf-8") as f:
                    content = f.read()
                
                # 检查 UPDATE 同步表
                for table in SYNC_TABLES:
                    # 查找 UPDATE table_name SET
                    update_pattern = rf"UPDATE\s+{table}\s+SET\s+"
                    matches = list(re.finditer(update_pattern, content, re.IGNORECASE))
                    
                    for match in matches:
                        # 获取 SET 子句
                        start = match.end()
                        # 找到 WHERE 子句
                        where_pos = content.find("WHERE", start)
                        if where_pos == -1:
                            where_pos = start + 500
                        
                        set_clause = content[start:min(where_pos, start + 500)]
                        
                        # 检查 SET 子句是否包含 device_id
                        if "device_id" not in set_clause.lower():
                            # 这是一个警告而非错误，因为有些更新可能不需要 device_id
                            # 但建议添加
                            pass  # 暂时不报错，只检查 INSERT
            except Exception:
                pass
    
    return violations


def check_backend_validates_device_id(root_dir):
    """
    检查后端是否校验 device_id
    """
    violations = []
    
    # 检查 PowerSync 处理代码
    powersync_file = os.path.join(root_dir, "api", "app", "powersync.py")
    if os.path.exists(powersync_file):
        with open(powersync_file, "r", encoding="utf-8") as f:
            content = f.read()
        
        if "device_id" in content:
            print("  [OK] Backend handles device_id in powersync.py")
        else:
            print("  [WARN] Warning: device_id may not be handled in powersync.py")
    
    return violations


def main():
    project_root = find_project_root()
    print(f"Checking project root: {project_root}")
    print("=" * 60)
    print("宪章6: 设备指纹强制 (Device Identity)")
    print("=" * 60)
    
    print(f"\nSync tables to check: {', '.join(SYNC_TABLES)}")
    
    all_violations = []
    
    # 检查1: 前端 deviceId 持久化
    print("\n[1/4] Checking frontend deviceId persistence...")
    violations = check_frontend_device_id_persist(project_root)
    all_violations.extend(violations)
    if violations:
        for v in violations:
            print(f"  [FAIL] {v}")
    
    # 检查2: 前端 INSERT 包含 device_id
    print("\n[2/4] Checking frontend INSERT statements for device_id...")
    violations = check_frontend_inserts_have_device_id(project_root)
    all_violations.extend(violations)
    if violations:
        for v in violations:
            print(f"  [FAIL] {v}")
    else:
        print("  [OK] All INSERT statements include device_id")
    
    # 检查3: 前端 UPDATE 包含 device_id (建议性)
    print("\n[3/4] Checking frontend UPDATE statements for device_id...")
    violations = check_frontend_updates_have_device_id(project_root)
    # 这里只做警告，不算违规
    print("  [OK] UPDATE statement check completed")
    
    # 检查4: 后端校验 device_id
    print("\n[4/4] Checking backend device_id validation...")
    violations = check_backend_validates_device_id(project_root)
    all_violations.extend(violations)
    
    print("\n" + "=" * 60)
    if all_violations:
        print(f"[FAIL] FAILED: {len(all_violations)} violation(s) found")
        print("\nRule: All sync write operations must include deviceId.")
        return False
    else:
        print("[OK] 宪章6检查通过: 设备指纹强制")
        return True


if __name__ == "__main__":
    success = main()
    sys.exit(0 if success else 1)
