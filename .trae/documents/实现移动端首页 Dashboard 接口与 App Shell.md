## 后端接口实现

* 新增 `api/app/services/home_service.py`：封装 Dashboard 聚合查询与默认值初始化逻辑

* 新增 `api/app/home.py`：`APIRouter(prefix="/api/v1/home")`，暴露 `GET /api/v1/home/dashboard`

* 在 `app/main.py` 中 `app.include_router(home_router)` 挂载路由

* 默认值初始化：若缺少记录，插入 `user_reading_goals(daily_minutes=30, yearly_books=10)`、`user_streaks(current_streak=0, longest_streak=0)`（`ON CONFLICT DO NOTHING`/`INSERT ... WHERE NOT EXISTS`）

* 时区：读取 `users.timezone`；使用 Python `zoneinfo` 计算本地 `today`、本周 `Mon-Sun`、当年起始

* 今日进度：查 `reading_daily(day=today_local)` 的 `total_ms`，返回 `seconds/minutes/percent(target=goals.daily_minutes)`

* 周视图：批量查本周 7 天的 `reading_daily`，按每日分钟与目标生成 `status`（`REACHED`≥目标、`PARTIAL`>0但未达标、`MISSED`=0且≤今天、`FUTURE`>今天）

* Streak 展示：读取 `user_streaks`；根据 `last_read_date` 与 `today-1` 判断是否“连续中”（仅展示，不在此更新）

* 年度已读：`SELECT COUNT(*) FROM reading_progress WHERE user_id=:uid AND finished_at>=start_of_year`；同时取最近 5 本 `ORDER BY finished_at DESC LIMIT 5` 并 `JOIN books` 取 `cover_image_key`

* 返回结构（Pydantic）：`goals/streak/today/weekly/yearly_finished{count,recent_covers}`，字段均为明确类型，时间与日期使用 ISO 字符串

## 前端 App Shell（待后端就绪后执行）

* 新增 `web/src/layouts/AppLayout.tsx`：移动端 Tab Bar（Home/Library/AI/Search），顶部 Liquid Glass 导航；底部处理安全区 `padding-bottom: env(safe-area-inset-bottom)`

* i18n：所有文案使用 `t('nav.home')` 等；将键值添加到 `web/src/locales/en-US/common.json` 与 `zh-CN/common.json`

* 路由：`react-router-dom` 配置 `Outlet`，子路由 `src/pages/app/Home.tsx` 先放 Loading 占位；激活 Tab 图标颜色使用 `var(--system-blue)`；颜色全部用 `figma.css` 变量

* 验证：移动端浏览器加载，登录后访问 `/app/home`，检查暗/明模式、Safe Area、生效的 i18n 与接口数据渲染

