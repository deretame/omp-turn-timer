# omp-turn-timer

Oh My Pi (omp) TUI extension：在每轮对话和思考块上显示开始/结束时间与耗时。

## 显示效果

- 每轮结束：`⏱ 14:57:34 → 14:57:35 · 用时 1.3s · 工具 1 次 · 思考 1 段`
- 思考块：`⏱ 14:56:47 → 14:56:47 · 2ms`

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
- 逐块时间仅内存态；恢复会话后只保留每轮 footer

## 命令时间为啥没有

omp 的 `registerTranscriptPresenter` 只能把工具卡片画成 full / compact / hidden，没有“在保留原卡片的同时追加一行”的接口。返回 compact 会替换内置命令卡片（命令、输出、退出码等），所以本插件不接管命令卡片。命令卡片本身已经显示耗时；开始/结束时间只能在替换卡片的前提下显示。

## 卸载

```sh
omp plugin uninstall omp-turn-timer
```
