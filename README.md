# Bot-Group: one

拥有基础群管功能和内置广告拦截功能

基于CF worker实现，至于环境变量自己想

`ADMIN_IDS`: 管理员列表ID(用逗号分隔)
`AI_API_KEY`: 模型密钥
`AI_CUSTOM_REPLY`: 拦截消息时启动AI自动回复,否则将使用模板回复(默认true)
`AI_PROVIDER`: 模型兼容供应商(默认openai)
`AI_SCAN_AUTO_DELETE`: 启动默认删除需要拦截的消息(默认true)
`AI_SCAN_ENABLED`: 启动模型自动扫描聊天记录(默认true)
`ASYNC_AI_WORKER_URL`: https://agent-api.module.ccb.rip/ (填这个就行)
`BOT_TOKEN`: tg bot的token
`ENABLED_GROUPS`: 启用群组的ID（逗号分隔）
