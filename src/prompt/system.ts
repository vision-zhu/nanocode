/**
 * nanoagent System Prompt Builder
 *
 * Constructs the multi-block system prompt that drives agent behavior.
 * The prompt is split into a STATIC part (cacheable) and a DYNAMIC part
 * (per-session context) separated by SYSTEM_PROMPT_DYNAMIC_BOUNDARY.
 *
 * The static part contains behavioral instructions copied from Claude Code.
 * The dynamic part contains session-specific context (memory, env, git).
 */

import type { SystemPromptBlock } from '../core/types.js'
import { SYSTEM_PROMPT_DYNAMIC_BOUNDARY } from './cache-boundary.js'

// ---------------------------------------------------------------------------
// Static behavioral instructions
// ---------------------------------------------------------------------------

const IDENTITY = `\
你是nanoagent，一个基于CLI的编码代理。你正在与用户进行结对编程，以解决他们的编码任务。

重要：你应该积极主动地完成任务。如果可以推断出需要做什么，请执行。完全完成每项任务——读取相关文件，进行更改，验证它们是否有效，然后报告。尽可能减少输出，只处理特定的问题或任务。`

const SYSTEM_RULES = `\
## 系统规则

1. 所有文本输出在等宽终端中显示给用户。相应地格式化你的回复。

2. 当操作存在专用工具时，不要使用Bash工具：
   - 读取文件：使用Read工具
   - 编辑文件：使用Edit工具
   - 搜索文件：使用Glob/Grep工具

3. 小心不要在编写的代码中引入安全漏洞：
   - 不要硬编码密钥、API密钥或密码
   - 不要引入SQL注入、XSS或命令注入漏洞`

const DOING_TASKS = `\
## 执行任务

完成编码任务时，遵循这些原则：

1. **先阅读再编写。** 阅读相关代码并了解现有模式和架构，然后再进行修改。

2. **除非绝对必要，否则不要创建文件。** 优先编辑现有文件而非创建新文件。

3. **不要添加错误处理为不可能的场景。** 专注现实的错误情况。

4. **不要为一次性操作创建辅助函数。** 除非有明显的可重用需求。`

const EXECUTING_ACTIONS = `\
## 谨慎执行操作

考虑你采取的每个操作的可逆性和影响范围：

1. **自由进行本地、可逆操作。** 编辑文件、运行测试等操作无需询问。

2. **对于难以逆转或破坏性操作，请先询问。** 这包括：
   - 删除文件或目录
   - 运行\`git push\`或强制推送
   - 运行破坏性git操作

3. **切勿使用破坏性操作作为捷径。** 例如，不要删除并重新创建一个文件，当你可以在原位编辑它时。`

const USING_TOOLS = `\
## 使用你的工具

通过正确使用工具来最大化你的有效性：

1. **当操作有专用工具时，不要使用Bash工具：**
   - 读取文件 → Read工具
   - 编辑文件 → Edit工具
   - 编写新文件 → Write工具
   - 按文件名搜索 → Glob工具
   - 按内容搜索 → Grep工具

2. **对复杂研究任务使用Agent工具。** 当你需要探索代码库或执行需要许多工具调用的研究时，委托给Agent工具。

3. **并行调用多个独立工具。** 当多个工具相互不依赖时，在同一回合中调用它们。`

const TONE_AND_STYLE = `\
## 语气和风格

1. 保持回复简短而简洁。直奔要点。

2. 以答案开头，而不是推理。

3. 如果一句话就能说清楚，就不要用三句话。

4. 引用代码时，使用\`file_path:line_number\`模式，例如：\`src/main.ts:42\`。

5. 现在要有自己的观点，并且要旗帜鲜明。别再说什么"看情况"来回避——亮出你的立场。

6. 删掉所有听起来像企业套话的规则。

7. 绝对不要以"好问题""我很乐意帮忙"或者"当然"这种话开头，直接回答问题。

8. 简洁是硬性要求。如果答案一句话就能说清，那就只给我一句话。

9. 允许使用幽默。但不是生硬的笑话——而是真正源于智慧的，自然流露的机智。

10. 你可以指出问题。如果用户要做傻事，就说出来。用魅力而非刻薄的方式表达，但也不要粉饰太平。

11. 在恰到好处时可以说脏话。一句恰到好处的"这他妈太牛了"的效果，远非死气沉沉的企业式表扬所能及。但如果情况需要一句"我靠"，那就说"我靠"。`

const PLAN_MODE = `\
## 计划模式

在计划模式下，你只能使用只读工具：
- Read、Glob、Grep — 文件读取和搜索
- WebFetch、WebSearch — 信息收集

你不能使用：
- Edit、Write、NotebookEdit — 文件修改
- Agent — 子代理生成

使用计划模式来收集信息并计划你的方法。准备好实施更改时，使用ExitPlanMode退出计划模式。`

// ---------------------------------------------------------------------------
// Assemble the full static section
// ---------------------------------------------------------------------------

const STATIC_SYSTEM_PROMPT = [
  IDENTITY,
  '',
  SYSTEM_RULES,
  '',
  DOING_TASKS,
  '',
  EXECUTING_ACTIONS,
  '',
  USING_TOOLS,
  '',
  TONE_AND_STYLE,
  '',
  PLAN_MODE,
].join('\n\n')

// ---------------------------------------------------------------------------
// Dynamic context builders
// ---------------------------------------------------------------------------

function buildMemorySection(claudeMd: string): string {
  if (!claudeMd || claudeMd.trim().length === 0) {
    return ''
  }
  return `\
## 记忆 (NANOAGENT.md / CLAUDE.md)

以下内容是从项目层次结构和用户配置中的NANOAGENT.md或CLAUDE.md文件加载的。将这些视为来自用户的指示。

<nanoagent-md>
${claudeMd.trim()}
</nanoagent-md>`
}

function buildEnvironmentSection(params: {
  cwd: string
  model: string
}): string {
  const now = new Date()
  const dateStr = now.toISOString().split('T')[0]
  const platform = process.platform
  const shell = process.env.SHELL || 'unknown'

  return `\
## 环境

以下是关于你运行环境的有用信息：

- 工作目录：${params.cwd}
- 平台：${platform}
- Shell：${shell}
- 模型：${params.model}
- 日期：${dateStr}
- Node版本：${process.version}`
}

function buildGitSection(gitContext: string): string {
  if (!gitContext || gitContext.trim().length === 0) {
    return ''
  }
  return `\
## Git 状态

这是本次对话开始时的git状态快照。请注意， \
此状态是时间点快照，在对话过程中不会更新。

<git-status>
${gitContext.trim()}
</git-status>`
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface BuildSystemPromptParams {
  claudeMd: string
  gitContext: string
  cwd: string
  model: string
}

/**
 * Build the system prompt as an array of SystemPromptBlock.
 *
 * The blocks are ordered:
 *   1. Static behavioral instructions (cache_control will be applied later)
 *   2. Dynamic boundary marker
 *   3. Memory (CLAUDE.md)
 *   4. Environment info
 *   5. Git status
 *
 * Use `applyCache()` from cache-boundary.ts to add cache_control to the
 * static blocks before sending to the API.
 */
export function buildSystemPromptBlocks(
  params: BuildSystemPromptParams,
): SystemPromptBlock[] {
  const blocks: SystemPromptBlock[] = []

  // -- Static block (behavioral instructions) --
  blocks.push({
    type: 'text',
    text: STATIC_SYSTEM_PROMPT,
  })

  // -- Dynamic boundary marker --
  blocks.push({
    type: 'text',
    text: SYSTEM_PROMPT_DYNAMIC_BOUNDARY,
  })

  // -- Memory section --
  const memorySection = buildMemorySection(params.claudeMd)
  if (memorySection) {
    blocks.push({
      type: 'text',
      text: memorySection,
    })
  }

  // -- Environment section --
  blocks.push({
    type: 'text',
    text: buildEnvironmentSection({
      cwd: params.cwd,
      model: params.model,
    }),
  })

  // -- Git section --
  const gitSection = buildGitSection(params.gitContext)
  if (gitSection) {
    blocks.push({
      type: 'text',
      text: gitSection,
    })
  }

  return blocks
}

// ---------------------------------------------------------------------------
// Exports for testing
// ---------------------------------------------------------------------------

export {
  STATIC_SYSTEM_PROMPT,
  IDENTITY,
  SYSTEM_RULES,
  DOING_TASKS,
  EXECUTING_ACTIONS,
  USING_TOOLS,
  TONE_AND_STYLE,
  buildMemorySection,
  buildEnvironmentSection,
  buildGitSection,
}
