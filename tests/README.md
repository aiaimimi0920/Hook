# Frontend tests

本目录由 Vitest 收集，保留原测试分类及运行语义：

- `unit/`：领域算法、状态与组件行为测试。
- `integration/`：跨模块运行时测试，以及读取源码、文档、配置的 repository contract。
- `performance/`：性能预算；`RuntimePerformanceGates.test.ts` 必须串行且不与其他测试 worker 争抢资源。
- `fixtures/`、`helpers/`、`setup/`：夹具、测试支持和环境初始化，不放生产代码。

从功能名和被测入口定位测试，生产代码位置见
[功能地图](../docs/development/CODE_ORGANIZATION.md#3-前端功能地图)。
新增断言优先验证可观察行为；仅路径、构建与治理约束使用源码合同。
迁移源码时保持断言语义，更新静态 import、mock、动态读取路径和夹具引用。

`npm test` 串行包含所有前端测试；`npm run test:parallel` 排除唯一的独立性能文件，
并由 `npm run test:performance` 单独执行它。不要更改预算或静默跳过文件。
`scripts/tests/` 的 Node/Python/PowerShell 工具测试及原生探针使用各自 runner；
Rust 测试仍由 Cargo 执行。详细命令见 [CONTRIBUTING](../CONTRIBUTING.md)。
