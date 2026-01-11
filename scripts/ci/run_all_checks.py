#!/usr/bin/env python3
"""
CICD 8大宪章统一检查器

运行所有8条宪章检查并生成汇总报告

使用方法：
    python scripts/ci/run_all_checks.py

@see CICD错误日志.md
"""

import os
import sys
import importlib.util
import traceback


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


# 8大宪章检查脚本
CHECKS = [
    ("宪章1: 架构降级零容忍", "check_no_arch_regression.py"),
    ("宪章2: DDL迁移圣洁性", "check_schema.py"),
    ("宪章3: 真实服务与Mock边界", "check_mock_boundaries.py"),
    ("宪章4: 依赖锁定原则", "check_dependency_lock.py"),
    ("宪章5: 基础设施对齐", "check_infra_alignment.py"),
    ("宪章6: 设备指纹强制", "check_device_identity.py"),
    ("宪章7: 架构隔离探针", "check_architecture.py"),
    ("宪章8: 类型契约强校验", "check_type_contracts.py"),
]


def run_check(script_path, project_root):
    """
    动态加载并运行检查脚本
    """
    try:
        # 改变工作目录
        original_cwd = os.getcwd()
        os.chdir(project_root)
        
        # 动态加载模块
        spec = importlib.util.spec_from_file_location("check_module", script_path)
        module = importlib.util.module_from_spec(spec)
        sys.modules["check_module"] = module
        spec.loader.exec_module(module)
        
        # 运行 main 函数
        if hasattr(module, "main"):
            result = module.main()
            os.chdir(original_cwd)
            return result
        else:
            print(f"  [WARN] No main() function in {script_path}")
            os.chdir(original_cwd)
            return True
            
    except Exception as e:
        print(f"  [FAIL] Error running check: {e}")
        traceback.print_exc()
        os.chdir(original_cwd)
        return False


def main():
    project_root = find_project_root()
    ci_dir = os.path.join(project_root, "scripts", "ci")
    
    print("=" * 70)
    print("          CICD 8大宪章统一检查器")
    print("=" * 70)
    print(f"\n项目根目录: {project_root}")
    print(f"CI脚本目录: {ci_dir}\n")
    
    results = []
    
    for i, (name, script_name) in enumerate(CHECKS, 1):
        print("\n" + "-" * 70)
        print(f"运行 {name} ({i}/{len(CHECKS)})")
        print("-" * 70)
        
        script_path = os.path.join(ci_dir, script_name)
        
        if not os.path.exists(script_path):
            print(f"  [WARN] 脚本不存在: {script_name}")
            results.append((name, None, "NOT FOUND"))
            continue
        
        try:
            success = run_check(script_path, project_root)
            results.append((name, success, "PASS" if success else "FAIL"))
        except Exception as e:
            results.append((name, False, f"ERROR: {str(e)[:50]}"))
    
    # 汇总报告
    print("\n" + "=" * 70)
    print("                    汇总报告")
    print("=" * 70)
    
    passed = sum(1 for _, success, _ in results if success is True)
    failed = sum(1 for _, success, _ in results if success is False)
    not_found = sum(1 for _, success, _ in results if success is None)
    
    for name, success, status in results:
        if success is True:
            icon = "[OK]"
        elif success is False:
            icon = "[FAIL]"
        else:
            icon = "[WARN]"
        print(f"  {icon} {name}: {status}")
    
    print("\n" + "-" * 70)
    print(f"通过: {passed}/{len(CHECKS)}")
    print(f"失败: {failed}/{len(CHECKS)}")
    if not_found > 0:
        print(f"缺失: {not_found}/{len(CHECKS)}")
    print("-" * 70)
    
    if failed > 0:
        print("\n[FAIL] CICD检查失败 - 请修复上述问题后重试")
        return False
    elif not_found > 0:
        print("\n[WARN] CICD检查部分完成 - 部分脚本缺失")
        return True  # 允许继续，但警告
    else:
        print("\n[OK] CICD检查全部通过！")
        return True


if __name__ == "__main__":
    success = main()
    sys.exit(0 if success else 1)
