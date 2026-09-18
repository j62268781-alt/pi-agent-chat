# Subagent 定义样例（pi-subagents 即插即用）

两个开箱即用的 agent 定义，配合 [pi-subagents](https://github.com/nicobailon/pi-subagents) 使用：

- `explore.md` — 只读代码侦查：返回结构化发现，供另一个 agent 直接行动，不重复读文件
- `general.md` — 通用委托：完整编辑工具集 + 隔离上下文，端到端完成任务

## 使用

把 md 文件拷到 `~/.pi/agent/agents/` 即可，pi-subagents 会自动发现：

```bash
cp docs/examples/agents/*.md ~/.pi/agent/agents/
```

之后在对话里直接说 "Use explore to scout the auth module" 之类的自然语言即可调用。
