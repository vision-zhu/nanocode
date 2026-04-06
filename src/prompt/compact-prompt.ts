/**
 * nanoagent Compact Prompt
 *
 * The prompt used to instruct the model to summarize a conversation
 * when context compaction is triggered. This is sent as a user message
 * along with the messages to be summarized.
 *
 * The 9-section format matches Claude Code's compaction prompt exactly.
 */

// ---------------------------------------------------------------------------
// Compact prompt — 9 sections
// ---------------------------------------------------------------------------

export const COMPACT_PROMPT = `\
你的任务是创建此对话的详细摘要，以 \
替换对话历史。此摘要将用作 \
继续对话的上下文，因此必须保留所有重要信息。

摘要应详细到读者无需丢失重要上下文即可 \
继续对话。

请将摘要组织成以下部分：

1. **主要请求和意图**：用户试图实现什么？ \
他们的目标是什么？

2. **关键技术概念**：重要的技术细节、架构 \
决策、讨论的算法

3. **文件和代码部分**：提及或修改的重要文件，包含 \
完整的代码片段（包含文件路径和行号）

4. **错误和修复**：遇到的任何错误及其解决方法

5. **问题解决**：尝试的方法、哪些有效和哪些无效

6. **所有用户消息**：保留所有用户消息的确切内容和意图

7. **待办任务**：仍需完成的任务

8. **当前工作**：当前正在处理的内容

9. **可选下一步**：如果有明确的下一步，请描述 \
（应与用户的最新请求一致）

重要指导原则：
- 逐字保留所有文件路径、代码片段和错误消息
- 包含代码修改的具体行号
- 保持确切的命令行调用及其输出
- 保持事件的时间顺序
- 具体化——包含实际值、名称和标识符，而不是 \
泛泛的描述`

// ---------------------------------------------------------------------------
// Compact system instruction
// ---------------------------------------------------------------------------

/**
 * 用于压缩时的系统级指令。
 * 这告诉模型它的角色是总结，而不是继续充当
 * 编码代理。
 */
export const COMPACT_SYSTEM_INSTRUCTION = `\
你是一个对话总结器。你的工作是创建提供给你的对话的详细、 \
结构化摘要。你必须完全按照用户消息中指定的 \
格式和指导原则执行。不要 \
尝试继续对话、回答问题或采取任何 \
操作。仅生成摘要。`

// ---------------------------------------------------------------------------
// Compact boundary marker
// ---------------------------------------------------------------------------

/**
 * Marker text inserted into the conversation to indicate where a
 * compaction occurred. This is used to find the boundary when a
 * subsequent compaction is needed.
 */
export const COMPACT_BOUNDARY_MARKER = '[CONVERSATION_COMPACTED]'

/**
 * Wraps a summary in the standard compact message format.
 */
export function formatCompactSummary(summary: string): string {
  return `\
${COMPACT_BOUNDARY_MARKER}

	以下是到目前为止的对话摘要。从摘要结束的地方继续 \
	对话。不要重复摘要中已覆盖的信息—— \
	从它结束的地方开始。

---

${summary}

---

	对话已被压缩。上述摘要取代了早期 \
	消息。从摘要结束处继续。`
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build the user message that asks the model to summarize a set of messages.
 * This combines COMPACT_PROMPT with a serialized version of the messages.
 */
export function buildCompactUserMessage(
  messagesText: string,
): string {
  return `\
${COMPACT_PROMPT}

以下是需要总结的对话：

<conversation>
${messagesText}
</conversation>

请根据上面的9部分格式生成摘要。`
}

/**
 * Serialize messages into a readable text format for the compaction prompt.
 * Each message is labeled by role and its text content is extracted.
 */
export function serializeMessagesForCompact(
  messages: Array<{ role: string; content: unknown[] }>,
): string {
  const lines: string[] = []

  for (const msg of messages) {
    const role = msg.role.toUpperCase()
    lines.push(`--- ${role} ---`)

    if (Array.isArray(msg.content)) {
      for (const block of msg.content) {
        const b = block as Record<string, unknown>
        if (b.type === 'text' && typeof b.text === 'string') {
          lines.push(b.text)
        } else if (b.type === 'tool_use') {
          lines.push(
            `[Tool call: ${b.name}(${JSON.stringify(b.input).slice(0, 500)})]`,
          )
        } else if (b.type === 'tool_result') {
          const content =
            typeof b.content === 'string'
              ? b.content
              : JSON.stringify(b.content)
          const truncated =
            content.length > 1000
              ? content.slice(0, 1000) + '...[truncated]'
              : content
          lines.push(`[Tool result: ${truncated}]`)
        } else if (b.type === 'thinking' && typeof b.thinking === 'string') {
          // Omit thinking blocks from compact — they are internal
        }
      }
    }

    lines.push('')
  }

  return lines.join('\n')
}
