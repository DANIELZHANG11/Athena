## 第一章：CI/CD 六大宪章 (The 6 Commandments)

### 1. “架构降级”零容忍 (No Architectural Regression)
*   **规则**：严禁为了通过测试或简化开发而移除核心架构保障。
*   **具体表现**：
    *   **严禁**移除数据库事务中的 `FOR UPDATE` 锁。
    *   **严禁**移除原子更新（Atomic Update）逻辑。
    *   **必须**在同一事务中完成计费扣除与业务写入。

### 2. DDL 迁移圣洁性 (Migration Sanctity)
*   **规则**：数据库结构的任何变更必须通过 Alembic 迁移脚本完成。
*   **具体表现**：
    *   **严禁**在业务代码中执行 `CREATE/ALTER TABLE`。
    *   **严禁**使用 `if not exists` 偷懒。

### 3. 真实服务与 Mock 的边界 (Mocking Boundaries)
*   **规则**：CI 环境资源有限，生产环境必须使用真实服务。
*   **具体表现**：
    *   **CI 环境**：允许使用 `MockOCR`、`MockEmbedder`。
    *   **生产/Docker 环境**：必须加载真实的 `PaddleOCR` 和 `BGE-M3`。

### 4. 依赖锁定原则 (Dependency Strictness)
*   **规则**：核心库版本必须严格锁定，禁止随意升级。

### 5. 基础设施对齐 (Infra Alignment)
*   **规则**：代码配置必须与 `docker-compose.yml` 定义的基础设施完全一致（SeaweedFS, OpenSearch）。

### 6. 设备指纹强制 (Device Identity)
*   **规则**：所有涉及同步的写操作（Write），**必须**携带 `deviceId`。
*   **具体表现**：
    *   前端生成 UUID 并持久化在 LocalStorage，严禁每次刷新变动。
    *   后端必须校验 `deviceId`，这是判断“冲突”还是“更新”的唯一依据。


Run pnpm run typecheck

> athena-web@0.0.1 typecheck /home/runner/work/Athena/Athena/web
> tsc --noEmit

Error: src/pages/NotesPage.tsx(169,5): error TS2657: JSX expressions must have one parent element.
Error: src/pages/NotesPage.tsx(194,72): error TS1003: Identifier expected.
Error: src/pages/NotesPage.tsx(194,74): error TS17002: Expected corresponding JSX closing tag for 'SelectTrigger'.
Error: src/pages/NotesPage.tsx(195,15): error TS17002: Expected corresponding JSX closing tag for 'Select'.
Error: src/pages/NotesPage.tsx(204,13): error TS17002: Expected corresponding JSX closing tag for 'div'.
Error: src/pages/NotesPage.tsx(274,7): error TS1005: ')' expected.
Error: src/pages/NotesPage.tsx(295,5): error TS1128: Declaration or statement expected.
Error: src/pages/NotesPage.tsx(296,3): error TS1109: Expression expected.
 ELIFECYCLE  Command failed with exit code 2.
Error: Process completed with exit code 2.

Run pytest -q api/tests
...........ssFF......F...                                                [100%]
=================================== FAILURES ===================================
_________________________ test_ocrmypdf_basic_function _________________________

program = 'tesseract'

    def get_version(
        program: str,
        *,
        version_arg: str = '--version',
        regex=r'(\d+(\.\d+)*)',
        env: OsEnviron | None = None,
    ) -> str:
        """Get the version of the specified program.
    
        Arguments:
            program: The program to version check.
            version_arg: The argument needed to ask for its version, e.g. ``--version``.
            regex: A regular expression to parse the program's output and obtain the
                version.
            env: Custom ``os.environ`` in which to run program.
        """
        args_prog = [program, version_arg]
        try:
>           proc = run(
                args_prog,
                close_fds=True,
                text=True,
                stdout=PIPE,
                stderr=STDOUT,
                check=True,
                env=env,
            )

/opt/hostedtoolcache/Python/3.11.14/x64/lib/python3.11/site-packages/ocrmypdf/subprocess/__init__.py:158: 
_ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ 
/opt/hostedtoolcache/Python/3.11.14/x64/lib/python3.11/site-packages/ocrmypdf/subprocess/__init__.py:62: in run
    proc = subprocess_run(args, env=env, check=check, **kwargs)
           ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
/opt/hostedtoolcache/Python/3.11.14/x64/lib/python3.11/subprocess.py:548: in run
    with Popen(*popenargs, **kwargs) as process:
         ^^^^^^^^^^^^^^^^^^^^^^^^^^^
/opt/hostedtoolcache/Python/3.11.14/x64/lib/python3.11/subprocess.py:1026: in __init__
    self._execute_child(args, executable, preexec_fn, close_fds,
_ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ 

self = <Popen: returncode: 255 args: ['tesseract', '--version']>
args = ['tesseract', '--version'], executable = b'tesseract', preexec_fn = None
close_fds = True, pass_fds = (), cwd = None
env = environ({'SHELL': '/bin/bash', 'SELENIUM_JAR_PATH': '/usr/share/java/selenium-server.jar', 'CONDA': '/usr/share/minico...T_VERSION': '8.4.2', 'PYTEST_CURRENT_TEST': 'tests/test_ocrmypdf_integration.py::test_ocrmypdf_basic_function (call)'})
startupinfo = None, creationflags = 0, shell = False, p2cread = -1
p2cwrite = -1, c2pread = 20, c2pwrite = 21, errread = -1, errwrite = 21
restore_signals = True, gid = None, gids = None, uid = None, umask = -1
start_new_session = False, process_group = -1

    def _execute_child(self, args, executable, preexec_fn, close_fds,
                       pass_fds, cwd, env,
                       startupinfo, creationflags, shell,
                       p2cread, p2cwrite,
                       c2pread, c2pwrite,
                       errread, errwrite,
                       restore_signals,
                       gid, gids, uid, umask,
                       start_new_session, process_group):
        """Execute program (POSIX version)"""
    
        if isinstance(args, (str, bytes)):
            args = [args]
        elif isinstance(args, os.PathLike):
            if shell:
                raise TypeError('path-like args is not allowed when '
                                'shell is true')
            args = [args]
        else:
            args = list(args)
    
        if shell:
            # On Android the default shell is at '/system/bin/sh'.
            unix_shell = ('/system/bin/sh' if
                      hasattr(sys, 'getandroidapilevel') else '/bin/sh')
            args = [unix_shell, "-c"] + args
            if executable:
                args[0] = executable
    
        if executable is None:
            executable = args[0]
    
        sys.audit("subprocess.Popen", executable, args, cwd, env)
    
        if (_USE_POSIX_SPAWN
                and os.path.dirname(executable)
                and preexec_fn is None
                and not close_fds
                and not pass_fds
                and cwd is None
                and (p2cread == -1 or p2cread > 2)
                and (c2pwrite == -1 or c2pwrite > 2)
                and (errwrite == -1 or errwrite > 2)
                and not start_new_session
                and process_group == -1
                and gid is None
                and gids is None
                and uid is None
                and umask < 0):
            self._posix_spawn(args, executable, env, restore_signals,
                              p2cread, p2cwrite,
                              c2pread, c2pwrite,
                              errread, errwrite)
            return
    
        orig_executable = executable
    
        # For transferring possible exec failure from child to parent.
        # Data format: "exception name:hex errno:description"
        # Pickle is not used; it is complex and involves memory allocation.
        errpipe_read, errpipe_write = os.pipe()
        # errpipe_write must not be in the standard io 0, 1, or 2 fd range.
        low_fds_to_close = []
        while errpipe_write < 3:
            low_fds_to_close.append(errpipe_write)
            errpipe_write = os.dup(errpipe_write)
        for low_fd in low_fds_to_close:
            os.close(low_fd)
        try:
            try:
                # We must avoid complex work that could involve
                # malloc or free in the child process to avoid
                # potential deadlocks, thus we do all this here.
                # and pass it to fork_exec()
    
                if env is not None:
                    env_list = []
                    for k, v in env.items():
                        k = os.fsencode(k)
                        if b'=' in k:
                            raise ValueError("illegal environment variable name")
                        env_list.append(k + b'=' + os.fsencode(v))
                else:
                    env_list = None  # Use execv instead of execve.
                executable = os.fsencode(executable)
                if os.path.dirname(executable):
                    executable_list = (executable,)
                else:
                    # This matches the behavior of os._execvpe().
                    executable_list = tuple(
                        os.path.join(os.fsencode(dir), executable)
                        for dir in os.get_exec_path(env))
                fds_to_keep = set(pass_fds)
                fds_to_keep.add(errpipe_write)
                self.pid = _fork_exec(
                        args, executable_list,
                        close_fds, tuple(sorted(map(int, fds_to_keep))),
                        cwd, env_list,
                        p2cread, p2cwrite, c2pread, c2pwrite,
                        errread, errwrite,
                        errpipe_read, errpipe_write,
                        restore_signals, start_new_session,
                        process_group, gid, gids, uid, umask,
                        preexec_fn, _USE_VFORK)
                self._child_created = True
            finally:
                # be sure the FD is closed no matter what
                os.close(errpipe_write)
    
            self._close_pipe_fds(p2cread, p2cwrite,
                                 c2pread, c2pwrite,
                                 errread, errwrite)
    
            # Wait for exec to fail or succeed; possibly raising an
            # exception (limited in size)
            errpipe_data = bytearray()
            while True:
                part = os.read(errpipe_read, 50000)
                errpipe_data += part
                if not part or len(errpipe_data) > 50000:
                    break
        finally:
            # be sure the FD is closed no matter what
            os.close(errpipe_read)
    
        if errpipe_data:
            try:
                pid, sts = os.waitpid(self.pid, 0)
                if pid == self.pid:
                    self._handle_exitstatus(sts)
                else:
                    self.returncode = sys.maxsize
            except ChildProcessError:
                pass
    
            try:
                exception_name, hex_errno, err_msg = (
                        errpipe_data.split(b':', 2))
                # The encoding here should match the encoding
                # written in by the subprocess implementations
                # like _posixsubprocess
                err_msg = err_msg.decode()
            except ValueError:
                exception_name = b'SubprocessError'
                hex_errno = b'0'
                err_msg = 'Bad exception data from child: {!r}'.format(
                              bytes(errpipe_data))
            child_exception_type = getattr(
                    builtins, exception_name.decode('ascii'),
                    SubprocessError)
            if issubclass(child_exception_type, OSError) and hex_errno:
                errno_num = int(hex_errno, 16)
                if err_msg == "noexec:chdir":
                    err_msg = ""
                    # The error must be from chdir(cwd).
                    err_filename = cwd
                elif err_msg == "noexec":
                    err_msg = ""
                    err_filename = None
                else:
                    err_filename = orig_executable
                if errno_num != 0:
                    err_msg = os.strerror(errno_num)
                if err_filename is not None:
>                   raise child_exception_type(errno_num, err_msg, err_filename)
E                   FileNotFoundError: [Errno 2] No such file or directory: 'tesseract'

/opt/hostedtoolcache/Python/3.11.14/x64/lib/python3.11/subprocess.py:1955: FileNotFoundError

The above exception was the direct cause of the following exception:

    def test_ocrmypdf_basic_function():
        """测试 OCRmyPDF 基本功能"""
        try:
            import io
    
            import fitz  # PyMuPDF
            import ocrmypdf
            from PIL import Image, ImageDraw, ImageFont
    
            # 创建一个包含文字的测试图片
            img = Image.new("RGB", (800, 400), color="white")
            draw = ImageDraw.Draw(img)
    
            # 添加测试文字
            text = "测试文字 Test Text 123"
            try:
                # 尝试使用系统字体
                font = ImageFont.truetype("arial.ttf", 40)
            except:
                font = ImageFont.load_default()
    
            draw.text((50, 150), text, fill="black", font=font)
    
            # 将图片转换为PDF
            img_bytes = io.BytesIO()
            img.save(img_bytes, format="PDF")
            img_bytes.seek(0)
    
            # 创建临时文件
            with tempfile.NamedTemporaryFile(suffix=".pdf", delete=False) as input_file:
                input_file.write(img_bytes.read())
                input_path = input_file.name
    
            with tempfile.NamedTemporaryFile(suffix=".pdf", delete=False) as output_file:
                output_path = output_file.name
    
            try:
                # 使用 OCRmyPDF 处理
                print(f"\n✓ Testing OCRmyPDF with test PDF...")
>               ocrmypdf.ocr(
                    input_path,
                    output_path,
                    language="chi_sim+eng",
                    force_ocr=True,
                    optimize=0,
                    progress_bar=False,
                )

api/tests/test_ocrmypdf_integration.py:99: 
_ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ 
/opt/hostedtoolcache/Python/3.11.14/x64/lib/python3.11/site-packages/ocrmypdf/api.py:413: in ocr
    check_options(options, plugin_manager)
/opt/hostedtoolcache/Python/3.11.14/x64/lib/python3.11/site-packages/ocrmypdf/_validation.py:243: in check_options
    _check_plugin_options(options, plugin_manager)
/opt/hostedtoolcache/Python/3.11.14/x64/lib/python3.11/site-packages/ocrmypdf/_validation.py:236: in _check_plugin_options
    plugin_manager.hook.check_options(options=options)
/opt/hostedtoolcache/Python/3.11.14/x64/lib/python3.11/site-packages/pluggy/_hooks.py:512: in __call__
    return self._hookexec(self.name, self._hookimpls.copy(), kwargs, firstresult)
           ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
/opt/hostedtoolcache/Python/3.11.14/x64/lib/python3.11/site-packages/pluggy/_manager.py:120: in _hookexec
    return self._inner_hookexec(hook_name, methods, kwargs, firstresult)
           ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
/opt/hostedtoolcache/Python/3.11.14/x64/lib/python3.11/site-packages/ocrmypdf/builtin_plugins/tesseract_ocr.py:141: in check_options
    check_external_program(
/opt/hostedtoolcache/Python/3.11.14/x64/lib/python3.11/site-packages/ocrmypdf/subprocess/__init__.py:326: in check_external_program
    found_version = version_checker()
                    ^^^^^^^^^^^^^^^^^
/opt/hostedtoolcache/Python/3.11.14/x64/lib/python3.11/site-packages/ocrmypdf/_exec/tesseract.py:98: in version
    return TesseractVersion(get_version('tesseract', regex=r'tesseract\s(.+)'))
                            ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
_ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ 

program = 'tesseract'

    def get_version(
        program: str,
        *,
        version_arg: str = '--version',
        regex=r'(\d+(\.\d+)*)',
        env: OsEnviron | None = None,
    ) -> str:
        """Get the version of the specified program.
    
        Arguments:
            program: The program to version check.
            version_arg: The argument needed to ask for its version, e.g. ``--version``.
            regex: A regular expression to parse the program's output and obtain the
                version.
            env: Custom ``os.environ`` in which to run program.
        """
        args_prog = [program, version_arg]
        try:
            proc = run(
                args_prog,
                close_fds=True,
                text=True,
                stdout=PIPE,
                stderr=STDOUT,
                check=True,
                env=env,
            )
            output: str = proc.stdout
        except FileNotFoundError as e:
>           raise MissingDependencyError(
                f"Could not find program '{program}' on the PATH"
            ) from e
E           ocrmypdf.exceptions.MissingDependencyError: Could not find program 'tesseract' on the PATH

/opt/hostedtoolcache/Python/3.11.14/x64/lib/python3.11/site-packages/ocrmypdf/subprocess/__init__.py:169: MissingDependencyError
----------------------------- Captured stdout call -----------------------------

✓ Testing OCRmyPDF with test PDF...
------------------------------ Captured log call -------------------------------
ERROR    ocrmypdf.subprocess:__init__.py:279 
The program 'tesseract' could not be executed or was not found on your
system PATH.
_______________________ test_ocrmypdf_coordinate_mapping _______________________

program = 'tesseract'

    def get_version(
        program: str,
        *,
        version_arg: str = '--version',
        regex=r'(\d+(\.\d+)*)',
        env: OsEnviron | None = None,
    ) -> str:
        """Get the version of the specified program.
    
        Arguments:
            program: The program to version check.
            version_arg: The argument needed to ask for its version, e.g. ``--version``.
            regex: A regular expression to parse the program's output and obtain the
                version.
            env: Custom ``os.environ`` in which to run program.
        """
        args_prog = [program, version_arg]
        try:
>           proc = run(
                args_prog,
                close_fds=True,
                text=True,
                stdout=PIPE,
                stderr=STDOUT,
                check=True,
                env=env,
            )

/opt/hostedtoolcache/Python/3.11.14/x64/lib/python3.11/site-packages/ocrmypdf/subprocess/__init__.py:158: 
_ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ 
/opt/hostedtoolcache/Python/3.11.14/x64/lib/python3.11/site-packages/ocrmypdf/subprocess/__init__.py:62: in run
    proc = subprocess_run(args, env=env, check=check, **kwargs)
           ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
/opt/hostedtoolcache/Python/3.11.14/x64/lib/python3.11/subprocess.py:548: in run
    with Popen(*popenargs, **kwargs) as process:
         ^^^^^^^^^^^^^^^^^^^^^^^^^^^
/opt/hostedtoolcache/Python/3.11.14/x64/lib/python3.11/subprocess.py:1026: in __init__
    self._execute_child(args, executable, preexec_fn, close_fds,
_ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ 

self = <Popen: returncode: 255 args: ['tesseract', '--version']>
args = ['tesseract', '--version'], executable = b'tesseract', preexec_fn = None
close_fds = True, pass_fds = (), cwd = None
env = environ({'SHELL': '/bin/bash', 'SELENIUM_JAR_PATH': '/usr/share/java/selenium-server.jar', 'CONDA': '/usr/share/minico...RSION': '8.4.2', 'PYTEST_CURRENT_TEST': 'tests/test_ocrmypdf_integration.py::test_ocrmypdf_coordinate_mapping (call)'})
startupinfo = None, creationflags = 0, shell = False, p2cread = -1
p2cwrite = -1, c2pread = 20, c2pwrite = 21, errread = -1, errwrite = 21
restore_signals = True, gid = None, gids = None, uid = None, umask = -1
start_new_session = False, process_group = -1

    def _execute_child(self, args, executable, preexec_fn, close_fds,
                       pass_fds, cwd, env,
                       startupinfo, creationflags, shell,
                       p2cread, p2cwrite,
                       c2pread, c2pwrite,
                       errread, errwrite,
                       restore_signals,
                       gid, gids, uid, umask,
                       start_new_session, process_group):
        """Execute program (POSIX version)"""
    
        if isinstance(args, (str, bytes)):
            args = [args]
        elif isinstance(args, os.PathLike):
            if shell:
                raise TypeError('path-like args is not allowed when '
                                'shell is true')
            args = [args]
        else:
            args = list(args)
    
        if shell:
            # On Android the default shell is at '/system/bin/sh'.
            unix_shell = ('/system/bin/sh' if
                      hasattr(sys, 'getandroidapilevel') else '/bin/sh')
            args = [unix_shell, "-c"] + args
            if executable:
                args[0] = executable
    
        if executable is None:
            executable = args[0]
    
        sys.audit("subprocess.Popen", executable, args, cwd, env)
    
        if (_USE_POSIX_SPAWN
                and os.path.dirname(executable)
                and preexec_fn is None
                and not close_fds
                and not pass_fds
                and cwd is None
                and (p2cread == -1 or p2cread > 2)
                and (c2pwrite == -1 or c2pwrite > 2)
                and (errwrite == -1 or errwrite > 2)
                and not start_new_session
                and process_group == -1
                and gid is None
                and gids is None
                and uid is None
                and umask < 0):
            self._posix_spawn(args, executable, env, restore_signals,
                              p2cread, p2cwrite,
                              c2pread, c2pwrite,
                              errread, errwrite)
            return
    
        orig_executable = executable
    
        # For transferring possible exec failure from child to parent.
        # Data format: "exception name:hex errno:description"
        # Pickle is not used; it is complex and involves memory allocation.
        errpipe_read, errpipe_write = os.pipe()
        # errpipe_write must not be in the standard io 0, 1, or 2 fd range.
        low_fds_to_close = []
        while errpipe_write < 3:
            low_fds_to_close.append(errpipe_write)
            errpipe_write = os.dup(errpipe_write)
        for low_fd in low_fds_to_close:
            os.close(low_fd)
        try:
            try:
                # We must avoid complex work that could involve
                # malloc or free in the child process to avoid
                # potential deadlocks, thus we do all this here.
                # and pass it to fork_exec()
    
                if env is not None:
                    env_list = []
                    for k, v in env.items():
                        k = os.fsencode(k)
                        if b'=' in k:
                            raise ValueError("illegal environment variable name")
                        env_list.append(k + b'=' + os.fsencode(v))
                else:
                    env_list = None  # Use execv instead of execve.
                executable = os.fsencode(executable)
                if os.path.dirname(executable):
                    executable_list = (executable,)
                else:
                    # This matches the behavior of os._execvpe().
                    executable_list = tuple(
                        os.path.join(os.fsencode(dir), executable)
                        for dir in os.get_exec_path(env))
                fds_to_keep = set(pass_fds)
                fds_to_keep.add(errpipe_write)
                self.pid = _fork_exec(
                        args, executable_list,
                        close_fds, tuple(sorted(map(int, fds_to_keep))),
                        cwd, env_list,
                        p2cread, p2cwrite, c2pread, c2pwrite,
                        errread, errwrite,
                        errpipe_read, errpipe_write,
                        restore_signals, start_new_session,
                        process_group, gid, gids, uid, umask,
                        preexec_fn, _USE_VFORK)
                self._child_created = True
            finally:
                # be sure the FD is closed no matter what
                os.close(errpipe_write)
    
            self._close_pipe_fds(p2cread, p2cwrite,
                                 c2pread, c2pwrite,
                                 errread, errwrite)
    
            # Wait for exec to fail or succeed; possibly raising an
            # exception (limited in size)
            errpipe_data = bytearray()
            while True:
                part = os.read(errpipe_read, 50000)
                errpipe_data += part
                if not part or len(errpipe_data) > 50000:
                    break
        finally:
            # be sure the FD is closed no matter what
            os.close(errpipe_read)
    
        if errpipe_data:
            try:
                pid, sts = os.waitpid(self.pid, 0)
                if pid == self.pid:
                    self._handle_exitstatus(sts)
                else:
                    self.returncode = sys.maxsize
            except ChildProcessError:
                pass
    
            try:
                exception_name, hex_errno, err_msg = (
                        errpipe_data.split(b':', 2))
                # The encoding here should match the encoding
                # written in by the subprocess implementations
                # like _posixsubprocess
                err_msg = err_msg.decode()
            except ValueError:
                exception_name = b'SubprocessError'
                hex_errno = b'0'
                err_msg = 'Bad exception data from child: {!r}'.format(
                              bytes(errpipe_data))
            child_exception_type = getattr(
                    builtins, exception_name.decode('ascii'),
                    SubprocessError)
            if issubclass(child_exception_type, OSError) and hex_errno:
                errno_num = int(hex_errno, 16)
                if err_msg == "noexec:chdir":
                    err_msg = ""
                    # The error must be from chdir(cwd).
                    err_filename = cwd
                elif err_msg == "noexec":
                    err_msg = ""
                    err_filename = None
                else:
                    err_filename = orig_executable
                if errno_num != 0:
                    err_msg = os.strerror(errno_num)
                if err_filename is not None:
>                   raise child_exception_type(errno_num, err_msg, err_filename)
E                   FileNotFoundError: [Errno 2] No such file or directory: 'tesseract'

/opt/hostedtoolcache/Python/3.11.14/x64/lib/python3.11/subprocess.py:1955: FileNotFoundError

The above exception was the direct cause of the following exception:

    def test_ocrmypdf_coordinate_mapping():
        """测试 OCRmyPDF 坐标映射准确性"""
        try:
            import io
    
            import fitz
            import ocrmypdf
            from PIL import Image, ImageDraw, ImageFont
    
            # 创建一个精确位置的文字图片
            img = Image.new("RGB", (1000, 600), color="white")
            draw = ImageDraw.Draw(img)
    
            # 在特定位置绘制文字
            test_positions = [
                (100, 100, "第一行文字"),
                (100, 200, "第二行文字"),
                (100, 300, "Third Line"),
            ]
    
            try:
                font = ImageFont.truetype("arial.ttf", 36)
            except:
                font = ImageFont.load_default()
    
            for x, y, text in test_positions:
                draw.text((x, y), text, fill="black", font=font)
    
            # 转换为PDF
            img_bytes = io.BytesIO()
            img.save(img_bytes, format="PDF")
            img_bytes.seek(0)
    
            with tempfile.NamedTemporaryFile(suffix=".pdf", delete=False) as input_file:
                input_file.write(img_bytes.read())
                input_path = input_file.name
    
            with tempfile.NamedTemporaryFile(suffix=".pdf", delete=False) as output_file:
                output_path = output_file.name
    
            try:
                # OCR处理
>               ocrmypdf.ocr(
                    input_path,
                    output_path,
                    language="chi_sim+eng",
                    force_ocr=True,
                    deskew=False,
                    clean=False,
                    progress_bar=False,
                )

api/tests/test_ocrmypdf_integration.py:179: 
_ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ 
/opt/hostedtoolcache/Python/3.11.14/x64/lib/python3.11/site-packages/ocrmypdf/api.py:413: in ocr
    check_options(options, plugin_manager)
/opt/hostedtoolcache/Python/3.11.14/x64/lib/python3.11/site-packages/ocrmypdf/_validation.py:243: in check_options
    _check_plugin_options(options, plugin_manager)
/opt/hostedtoolcache/Python/3.11.14/x64/lib/python3.11/site-packages/ocrmypdf/_validation.py:236: in _check_plugin_options
    plugin_manager.hook.check_options(options=options)
/opt/hostedtoolcache/Python/3.11.14/x64/lib/python3.11/site-packages/pluggy/_hooks.py:512: in __call__
    return self._hookexec(self.name, self._hookimpls.copy(), kwargs, firstresult)
           ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
/opt/hostedtoolcache/Python/3.11.14/x64/lib/python3.11/site-packages/pluggy/_manager.py:120: in _hookexec
    return self._inner_hookexec(hook_name, methods, kwargs, firstresult)
           ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
/opt/hostedtoolcache/Python/3.11.14/x64/lib/python3.11/site-packages/ocrmypdf/builtin_plugins/tesseract_ocr.py:141: in check_options
    check_external_program(
/opt/hostedtoolcache/Python/3.11.14/x64/lib/python3.11/site-packages/ocrmypdf/subprocess/__init__.py:326: in check_external_program
    found_version = version_checker()
                    ^^^^^^^^^^^^^^^^^
/opt/hostedtoolcache/Python/3.11.14/x64/lib/python3.11/site-packages/ocrmypdf/_exec/tesseract.py:98: in version
    return TesseractVersion(get_version('tesseract', regex=r'tesseract\s(.+)'))
                            ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
_ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ 

program = 'tesseract'

    def get_version(
        program: str,
        *,
        version_arg: str = '--version',
        regex=r'(\d+(\.\d+)*)',
        env: OsEnviron | None = None,
    ) -> str:
        """Get the version of the specified program.
    
        Arguments:
            program: The program to version check.
            version_arg: The argument needed to ask for its version, e.g. ``--version``.
            regex: A regular expression to parse the program's output and obtain the
                version.
            env: Custom ``os.environ`` in which to run program.
        """
        args_prog = [program, version_arg]
        try:
            proc = run(
                args_prog,
                close_fds=True,
                text=True,
                stdout=PIPE,
                stderr=STDOUT,
                check=True,
                env=env,
            )
            output: str = proc.stdout
        except FileNotFoundError as e:
>           raise MissingDependencyError(
                f"Could not find program '{program}' on the PATH"
            ) from e
E           ocrmypdf.exceptions.MissingDependencyError: Could not find program 'tesseract' on the PATH

/opt/hostedtoolcache/Python/3.11.14/x64/lib/python3.11/site-packages/ocrmypdf/subprocess/__init__.py:169: MissingDependencyError
------------------------------ Captured log call -------------------------------
ERROR    ocrmypdf.subprocess:__init__.py:279 
The program 'tesseract' could not be executed or was not found on your
system PATH.
___________ TestInitialSyncResponseStructure.test_sync_category_enum ___________

self = <test_sync_core.TestInitialSyncResponseStructure object at 0x7ff45d56e2d0>

    def test_sync_category_enum(self):
        """验证同步类别枚举"""
>       from app.sync import SyncCategory
E       ModuleNotFoundError: No module named 'app'

api/tests/test_sync_core.py:84: ModuleNotFoundError
=============================== warnings summary ===============================
<frozen importlib._bootstrap>:283
  <frozen importlib._bootstrap>:283: DeprecationWarning: the load_module() method is deprecated and slated for removal in Python 3.12; use exec_module() instead

tests/test_admin_billing.py::test_admin_billing_flow
  /opt/hostedtoolcache/Python/3.11.14/x64/lib/python3.11/site-packages/pytest_asyncio/plugin.py:761: DeprecationWarning: The event_loop fixture provided by pytest-asyncio has been redefined in
  /home/runner/work/Athena/Athena/api/tests/conftest.py:6
  Replacing the event_loop fixture with a custom implementation is deprecated
  and will lead to errors in the future.
  If you want to request an asyncio event loop with a scope other than function
  scope, use the "scope" argument to the asyncio mark when marking the tests.
  If you want to return different types of event loops, use the event_loop_policy
  fixture.
  
    warnings.warn(

-- Docs: https://docs.pytest.org/en/stable/how-to/capture-warnings.html
=========================== short test summary info ============================
FAILED api/tests/test_ocrmypdf_integration.py::test_ocrmypdf_basic_function - ocrmypdf.exceptions.MissingDependencyError: Could not find program 'tesseract' on the PATH
FAILED api/tests/test_ocrmypdf_integration.py::test_ocrmypdf_coordinate_mapping - ocrmypdf.exceptions.MissingDependencyError: Could not find program 'tesseract' on the PATH
FAILED api/tests/test_sync_core.py::TestInitialSyncResponseStructure::test_sync_category_enum - ModuleNotFoundError: No module named 'app'
3 failed, 20 passed, 2 skipped, 2 warnings in 21.78s
Error: Process completed with exit code 1.