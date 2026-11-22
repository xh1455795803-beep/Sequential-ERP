# AI Teams - 多团队协作系统

基于 **CrewAI** 框架构建的 **7 个专业 AI 团队**，覆盖软件开发、数据分析、内容创作、项目管理、DevOps、产品设计、研究调查等场景。

## 🚀 快速开始

```bash
# 1. 进入项目目录
cd /workspace/ai_teams

# 2. 安装依赖
python install.py

# 3. 配置 API Key
cp .env.example .env  # 编辑 .env 填入你的 LLM API Key

# 4. 运行团队
python main.py list          # 查看所有团队
python main.py run dev --input "用 Python 写一个 Web 爬虫"
python main.py run data --input "分析电商销售数据趋势"
python main.py demo          # 查看更多示例
```

## 🤖 7 个 AI 团队

| 团队 | 名称 | 角色 | 场景 |
|------|------|------|------|
| `dev` | **DevCrew** 软件开发团队 | 架构师 + 开发者 + 审查员 + 测试工程师 | 代码开发全流程 |
| `data` | **DataCrew** 数据分析团队 | 数据工程师 + 分析师 + 统计学家 + 报告撰写者 | 数据洞察 |
| `content` | **ContentCrew** 内容创作团队 | 策划者 + 撰稿人 + 编辑 + SEO 专家 | 内容生产 |
| `research` | **ResearchCrew** 研究调查团队 | 研究员 + 事实核查员 + 分析师 + 报告撰写者 | 深度调研 |
| `pm` | **PMCrew** 项目管理团队 | 项目经理 + WBS 专家 + 协调员 + 风险专家 | 项目规划 |
| `devops` | **DevOpsCrew** DevOps 团队 | 基础设施工程师 + CI/CD + 安全 + SRE | 部署运维 |
| `design` | **DesignCrew** 产品设计团队 | PM + UX 研究员 + 交互设计师 + 视觉设计师 | 产品设计 |

## 📂 项目结构

```
ai_teams/
├── main.py              # 统一入口
├── install.py           # 一键安装
├── requirements.txt     # Python 依赖
├── .env.example         # 环境变量示例
├── teams/               # 7 个团队实现
│   ├── __init__.py
│   ├── base.py          # 基础类
│   ├── dev_crew.py
│   ├── data_crew.py
│   ├── content_crew.py
│   ├── research_crew.py
│   ├── pm_crew.py
│   ├── devops_crew.py
│   └── design_crew.py
└── output/              # 各团队输出结果
```

## 💡 独立使用每个团队

```python
from teams import DevCrew, DataCrew, ContentCrew

# 软件开发团队
dev = DevCrew()
result = dev.run({"project_requirement": "用 Python 写一个 API"})

# 数据分析团队
data = DataCrew()
result = data.run({"analysis_topic": "Q1 销售数据"})

# 快捷函数
from teams.dev_crew import quick_build
result = quick_build("写一个 Flask Todo API")
```

## 🔧 自定义与扩展

每个团队都继承 `BaseTeam` 基类，可以：

- 修改 Agent 的 `role`、`goal`、`backstory`
- 添加自定义工具（Tools）
- 调整 Task 的 `description` 和 `expected_output`
- 改变执行流程（`Process.sequential` / `Process.hierarchical` / `Process.parallel`）
- 设置 `memory=True` 启用记忆功能

## 📝 输出说明

每个团队运行后会在 `output/` 目录生成 Markdown 文件，例如：

- `output/dev_architecture.md` - 架构设计文档
- `output/dev_implementation.md` - 代码实现
- `output/research_final_report.md` - 研究报告
- `output/content_final.md` - 最终内容

## 📚 参考

- [CrewAI 官方文档](https://docs.crewai.com/)
- [CrewAI PyPI](https://pypi.org/project/crewai/)

## 📄 许可证

MIT License
