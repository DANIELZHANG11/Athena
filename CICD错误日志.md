Run flake8 api --count --select=E9,F63,F7,F82 --show-source --statistics
api/app/tasks.py:1198:9: F824 `nonlocal conversion_done` is unused: name is never assigned in scope
        nonlocal conversion_done
        ^
api/app/tasks.py:1227:9: F824 `nonlocal all_text_parts` is unused: name is never assigned in scope
        nonlocal processed_count, all_text_parts
        ^
2     F824 `nonlocal conversion_done` is unused: name is never assigned in scope
2
Error: Process completed with exit code 1.