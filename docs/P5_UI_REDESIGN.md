# P5 Android 界面改造

在 MuMu Android 15 上启动了 0.6.6，并用同一组合成数据记录改造前后的布局。基线中的主要问题是学习页首屏操作集中、课程与待交任务缺少层级，周课表长课名拥挤，待办复选框与行内容争抢空间，生活与我的页面重复占用卡片。

| 区域 | 改动 |
| --- | --- |
| 全局 | 在 `web/app.css` 统一页面、分隔线、状态色、圆角、4px 间距和文字层级。五项底栏固定等宽，选中项使用图标底色和文字强化。按钮、复选框和列表行提供焦点与按压反馈，动画遵循系统减少动画偏好。 |
| 学习 | 将刷新放到页标题旁，按已读取的课程缓存汇总待处理作业并注明覆盖范围。课程行保留状态和可靠发布时间，作业、考试、活动与通知放进详情。折叠区展示隐藏课程、隐藏原因及检查时间，保留展开、滚动及课程选择。展开折叠区不发起查询。 |
| 教务 | 统一三个子栏目的切换和学期工具栏。周课表强化当天与节次，采用柔和课程色块；日视图与详情保留完整课名、教师和地点。成绩按课程、成绩、学分对齐，按校方实际字段显示绩点。考试按日期组织，保留未公布、校方限制和查询失败提示。 |
| 待办 | 首屏提供未完成数量、快速添加及筛选。全部视图分组显示已完成与未完成事项。复选框触控区为 48px，编辑移入可滚动底部弹层，删除在弹层内确认。快速添加保留输入焦点。 |
| 生活 / 我的 | 精简账户、查询状态和入口。保留 798 授权配置不足的提示及官方 App 入口。我的页面统一账号行，新增跟随系统、浅色、深色外观设置，区分网页缓存清理和个人数据。 |

`web/index.html` 和 `web/app.js` 调整页面布局、渲染与交互状态，`web/todo-page.js` 继续使用原有待办存储。Android 主界面和夜间资源统一 WebView、窗口及系统栏底色。学习通 30 天规则、隐藏课程 12 小时复查间隔、各平台授权与查询协议、教务同步、账号隔离和待办存储结构沿用原实现。

360px 周视图保留七天同屏，超长课程名可在详情或日视图完整查看。

## MuMu 对照截图

截图统一使用合成课程、任务、成绩、考试和账号状态。

| 页面 | 0.6.6 基线 | 0.7.0 改造后 |
| --- | --- | --- |
| 教务 · 课表 | [改造前](p5-screenshots/before-schedule.png) | [改造后](p5-screenshots/after-schedule.png) |
| 教务 · 成绩 | [改造前](p5-screenshots/before-grades.png) | [改造后](p5-screenshots/after-grades.png) |
| 教务 · 考试 | [改造前](p5-screenshots/before-exams.png) | [改造后](p5-screenshots/after-exams.png) |
| 学习 | [改造前](p5-screenshots/before-study.png) | [改造后](p5-screenshots/after-study.png) |
| 待办 | [改造前](p5-screenshots/before-todo.png) | [改造后](p5-screenshots/after-todo.png) |
| 生活 | [改造前](p5-screenshots/before-life.png) | [改造后](p5-screenshots/after-life.png) |
| 我的 | [改造前](p5-screenshots/before-me.png) | [改造后](p5-screenshots/after-me.png) |

[深色学习页](p5-screenshots/after-dark-study.png) · [深色成绩页](p5-screenshots/after-dark-grades.png) · [深色待办](p5-screenshots/after-dark-todo.png) · [待办编辑弹层](p5-screenshots/after-todo-editor.png)
