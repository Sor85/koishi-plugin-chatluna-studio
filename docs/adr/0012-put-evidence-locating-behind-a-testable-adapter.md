# 把证据定位收进带 adapter 的可测 module

证据定位的展开决策、帧时序与滚动校正集中在 `client/shared/evidence-locator.ts`，通过 `EvidenceLocatorAdapter` 这一个 seam 访问外界。adapter 是唯一的 DOM、渲染状态与计时出口：`measure` 只交出元素顶、滚动容器顶与当前滚动量三个数字，滚动容器的选择规则留在视图侧——检查器取 `.chatluna-studio-model-trajectory-inspector-body`，工作台分析取外层 `.chatluna-studio-model-request-detail`，避免只滚内层分析卡片而让右侧详情停在顶部；`nextTick`、`frame`、`observeResize`、`schedule` 交出全部时序原语。seam 有两个真实实现：`analysis-view.vue` 中的 DOM adapter 和测试中的数字化假 adapter。

定位 module 只拥有「定位时该展开哪些」的决策与它们之间的先后顺序，不拥有展开态本身。这条分工来自缺陷的实际形状：展开决策一直是对的，出错的始终是展开、测量、折叠与滚动的时序，因此只有时序需要进入可测 module。展开态（折叠卡片、原始消息、展开工具、强制展开长文本）起初留在视图里以 Vue `ref` 持有，后来收进 `client/model-request/analysis-expansion.ts`，adapter 那八项展开与原文操作因此退成转发。决策与状态分离这条线没有变，变的只是状态的主人从组件换成了一个反应式 module；理由是「原文一旦挂载就留着」与「搜索命中用集合替换而不是逐条展开」这两条规则改坏了都不报错，留在组件里没有观察面。当前高亮与当前 occurrence 是例外，它们仍由本 module 持有并在它自己的复位里清掉——搬去展开态那边会把一次复位拆到两个主人手里。跨视图触发定位统一为 `LocateRequest { evidenceId, seq }`，`seq` 只用于触发一次定位，不参与证据身份；原先分散在工作台、轨迹与分析视图的三个计数器收敛为 module 内部的一个 generation。

不引入 jsdom、happy-dom 或 `@vue/test-utils`。jsdom 不实现布局，`getBoundingClientRect()` 恒返回 0 且没有真实滚动，恰好无法验证本 module 唯一关心的事实——目标最终停在哪个滚动位置；挂载组件只能断言「有没有调用」，却要为此让全部测试切换运行环境。真实布局仍由 Chrome 与 Firefox 手工验证承担。因此「仓库没有组件挂载测试」是这条决策的结果，不是待补的缺口。

区域内的输入、loading 与浮层状态由所属模块本地持有，本决策是那条规则的显式例外：证据定位是跨区域行为而不是区域本地状态，所以它拥有自己的 module 与 seam，而不是被切碎回三个区域。ADR-0008 继续定义共享模型证据投影是唯一理解协议结构的 module，定位 module 只消费投影产物与证据身份，不解释协议字段。
