# ToDos

## 订阅套餐：宣传卖点文案（管理员可自定义，多条）

- [x] Backend：SubscriptionPlan 新增 `promo_highlights`（text，按行存储）
- [x] Backend：Admin create/update 校验最多 5 条（过滤空行后计数）
- [x] Backend：GetSubscriptionPlans 在 `lang != zh` 时将 `promo_highlights` 一并走 TranslateContent 并回填
- [x] Frontend：用户端 `/console/topup` 订阅卡片按行渲染卖点（无内容不显示）
- [x] Frontend：管理员套餐编辑弹窗新增 TextArea（每行一条，最多5条）
- [x] Frontend：TS 类型 SubscriptionPlan 增加 `promo_highlights?: string`
- [x] Verification：`cd web && bun install && bun run build` — passed
- [ ] Verification：`go test ./...`（当前 worktree 被无关编译错误阻塞：缺少 `web/dist` embed + 缺少 `model.Is*IdAlreadyTaken`）

## 工单附件：免责声明 + 预览替代下载 + 随机文件名（Presign）

- [x] Backend：工单附件 presign 支持 `disposition=inline|attachment`（默认 inline，非法回退 inline）
- [x] Backend：presign GET 强制 `Content-Disposition`，文件名为 **12 位 base62 随机名 + 安全 ext**（不暴露原始文件名）
- [x] Backend：S3/OSS presign GET 支持 response header overrides（ResponseContentDisposition / ResponseContentType）
- [x] Frontend：用户端工单详情附件点击改为弹窗预览（不再 window.open 直接打开）
- [x] Frontend：预览弹窗提供”下载”按钮（`disposition=attachment`）
- [x] Frontend：hooks `presignAttachment(attId, { disposition })` 支持 query 参数
- [x] i18n：新增 keys（免责声明标题/正文、预览、下载）并接入页面
- [x] Frontend：在工单详情附件区附近插入固定免责声明提示块
- [x] Verification：`go test ./...` — passed (all packages with tests)
- [x] Verification：`cd web && bun run build` — passed
- [ ] Manual check：对 presign URL 执行 `curl -I` 校验 Content-Disposition（inline/attachment）和随机文件名

## 发票系统（用户申请 + 管理员上传电子发票）

- [x] Backend：新增 invoice 相关 models（InvoiceApplication/Item/Upload/File）并注册到 `model/main.go` migration
- [x] Backend：实现用户侧可开票订单列表（ListInvoiceableOrdersForUser）
- [x] Backend：实现 invoice_service 剩余函数（取消申请、管理员 presign 上传、finalize 绑定、用户/管理员 presign 下载）
- [x] Backend：新增 dto/controller/router（用户 + 管理员最小可用接口）
- [ ] Verification：`go test ./...`（注意：需要先 `cd web && bun run build` 生成 `web/dist`）
- [ ] Frontend：用户端发票页面（申请 + 列表/详情）
- [ ] Frontend：管理员端发票页面（审核/上传/绑定/下载）
- [ ] Frontend：i18n + TS types 补齐

## Admin：站点 RPM 实时可视化（5秒快照，30分钟历史）

- [x] Backend：新增表 `site_rpm_snapshots`（total + site 行；(created_at, window_seconds, site_label) 唯一键）并注册到 `model/main.go` 迁移
- [x] Backend：master-only writer：每 5 秒计算一次 RPM（复用 `GetSiteRPM`），批量 upsert 快照
- [x] Backend：master-only pruner：每 60 秒清理超出 30 分钟（含 safety margin）的快照
- [x] Backend：新增 admin-only API：`GET /api/analytics/site-rpm/history`（range + since 增量）
- [x] Frontend：`/console/site-rpm` 页面改用 history 接口；维护 30 分钟 ring buffer；VChart 折线图（All + 全部站点）
- [x] Frontend：表格改从最新快照生成（不再扫 logs）
- [x] Verification：`go test ./...`
- [x] Verification：`cd web && bun run build`
