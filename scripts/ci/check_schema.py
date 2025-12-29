import os
import sys
import re

def check_schema_version(root_dir):
    schema_path = os.path.join(root_dir, "web", "src", "lib", "powersync", "schema.ts")
    if not os.path.exists(schema_path):
        print(f"Schema file not found: {schema_path}")
        return False
        
    with open(schema_path, "r", encoding="utf-8") as f:
        content = f.read()
        
    if "export const SCHEMA_VERSION =" not in content:
        print(f"Error: {schema_path} does not export SCHEMA_VERSION.")
        print("Rule: Frontend SQLite Schema changes must include a version number update.")
        return False
        
    print("Schema version check passed.")
    return True

def check_ddl_sanctity(root_dir):
    # Rule: No CREATE TABLE / ALTER TABLE in business code
    forbidden_patterns = [
        r"CREATE\s+TABLE",
        r"ALTER\s+TABLE",
        r"DROP\s+TABLE"
    ]
    
    # Exclude patterns (files or directories)
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
        "android", # web/android
        "ios", # web/ios
        "api/alembic",
        "api/migrations",
        "check_schema.py",
        "apply_v9_schema.py", # Script exemption
        "sync_rules.yaml", # PowerSync config
        "schema.ts", # The schema definition itself (if it contains raw SQL in comments)
        "powersync.js", # generated assets
        "index.js", # generated assets
    ]
    
    violations = []
    
    for root, dirs, files in os.walk(root_dir):
        # Normalize paths for exclusion check
        # Modify dirs in-place to skip traversing ignored directories
        dirs[:] = [d for d in dirs if d not in exclude_patterns and not d.startswith('.')]
        
        # Also check relative path from root to avoid scanning deep nested ignored folders if top level wasn't caught
        rel_root = os.path.relpath(root, root_dir).replace("\\", "/")
        if any(ex in rel_root.split("/") for ex in exclude_patterns):
            continue

        for file in files:
            if file.endswith((".py", ".ts", ".tsx", ".js", ".sql")):
                if file in exclude_patterns:
                    continue
                    
                # Skip minified files or assets
                if ".min." in file or "-DLPwgLDN" in file or "-tMoVcbjN" in file: # heuristics for built assets
                    continue

                file_path = os.path.join(root, file)
                rel_path = os.path.relpath(file_path, root_dir).replace("\\", "/")
                
                # Check file path against exclude patterns again
                if any(ex in rel_path for ex in exclude_patterns):
                    continue

                try:
                    with open(file_path, "r", encoding="utf-8", errors='ignore') as f:
                        content = f.read()
                        for pattern in forbidden_patterns:
                            if re.search(pattern, content, re.IGNORECASE):
                                violations.append(f"{rel_path}: Found Forbidden DDL '{pattern}'")
                                break
                except Exception as e:
                    pass 
                    
    if violations:
        print("DDL Sanctity Violations Found:")
        for v in violations:
            print(f"  - {v}")
        print("\nRule: Database structure changes must be done via Alembic migrations.")
        return False

    print("DDL sanctity check passed.")
    return True

if __name__ == "__main__":
    cwd = os.getcwd()
    # Adjust root finding logic
    if "scripts" in cwd:
        project_root = os.path.abspath(os.path.join(cwd, "../../"))
        if not os.path.exists(os.path.join(project_root, "web")):
             project_root = os.path.abspath(os.path.join(cwd, "../"))
    else:
        project_root = cwd

    print(f"Checking project root: {project_root}")
        
    v_ok = check_schema_version(project_root)
    d_ok = check_ddl_sanctity(project_root)
    
    if v_ok and d_ok:
        sys.exit(0)
    else:
        sys.exit(1)
