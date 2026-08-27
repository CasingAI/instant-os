# res-agent —— 分辨率自动对齐客机代理（XP 32 位）
# 一条 zig cc 命令交叉编译，无需本地 Windows 工具链。用法见 README.md。
# 等价的 shell 入口（单测调用）：scripts/build-res-agent.sh。
#
# 关键点：
# - -nostdlib：zig 的 mingw CRT 默认拉 UCRT（api-ms-win-crt-*.dll），XP 上没有
#   这组 DLL；res-agent.c 自带 memset/memcpy，入口直接指到 res_agent_entry。
# - -nostdlib 下 zig 不再自动提供 Windows 头文件，要显式 -isystem 指过去。
# - 产物必须过 patch-pe-xp-version.mjs：lld-link 默认写 PE OS/Subsystem 版本
#   6.00，XP 加载器直接拒绝加载（「不是有效的 Win32 应用程序」），补成 5.01。

ZIG     ?= zig cc
WIN_INC := $(shell zig env | sed -n 's/^ *\.lib_dir = "\(.*\)",$$/\1/p')/libc/include/any-windows-any

CFLAGS  ?= -target x86-windows-gnu -O2 -Wall -nostdlib -isystem$(WIN_INC)
LDFLAGS ?= -Wl,--subsystem,windows,-e,res_agent_entry
LDLIBS  ?= -lkernel32 -luser32 -lgdi32

res-agent.exe: res-agent.c patch-pe-xp-version.mjs
	$(ZIG) $(CFLAGS) $(LDFLAGS) -o $@ $< $(LDLIBS)
	node patch-pe-xp-version.mjs $@

# 诊断版（入口不同）：真 XP 上启动崩溃时，双击它按弹框序号定位病灶。
# 崩在 diag 4 与 5 之间 = ring3 IN 不可达；diag 1 都不出 = 加载层问题。
res-agent-diag.exe: res-agent-diag.c patch-pe-xp-version.mjs
	$(ZIG) $(CFLAGS) -Wl,--subsystem,windows,-e,res_diag_entry -o $@ $< $(LDLIBS)
	node patch-pe-xp-version.mjs $@

.PHONY: clean
clean:
	rm -f res-agent.exe res-agent-diag.exe
