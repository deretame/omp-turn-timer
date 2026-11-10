# omp-turn-timer

Oh My Pi (omp) TUI extension：在每轮对话、思考块、bash/eval 命令上显示开始/结束时间与耗时。

## 显示效果

- 每轮结束：`⏱ 14:57:34 → 14:57:35 · 用时 1.3s · 工具 1 次 · 思考 1 段`
- 思考块：`⏱ 14:56:47 → 14:56:47 · 2ms`
- bash/eval：`✓ bash · echo hi · 121ms`，下一行 `⏱ 14:55:45 → 14:55:45`

## 安装

```sh
omp plugin install github:deretame/omp-turn-timer
```

或本地 link：

```sh
omp plugin link /path/to/omp-turn-timer
```

重启 omp 后生效。

## 要求

- omp 18.18.x（测试于 18.18.6）
- 仅交互式 TUI 渲染；`omp -p` 不显示这些行
- 想看思考块时间：`omp config set hideThinkingBlock false`
- `extensionRenderers.transcriptPresenters` 会在未显式配置时运行时开启
- 逐块时间仅内存态；恢复会话后只保留每轮 footer

## 卸载

```sh
omp plugin uninstall omp-turn-timer
```
