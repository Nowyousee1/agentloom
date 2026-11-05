# STM32 Keil 工程：编译 / 烧录 / 中断验收

适用于本机的 STM32 工程（STM32CubeMX 生成结构 + Keil MDK5 + App/Bsp 自建模块）。

## 1. 编译

- 工具链：Keil MDK5，ARMCC V5.06。
- **验收线：0 Error / 0 Warning**，不要用「能生成 hex」代替。
- 工程里若有 `tests/`，先跑 PC 侧自检，再编固件；两侧都过才算编译阶段完成。

## 2. 烧录

```powershell
STM32_Programmer_CLI -c port=SWD mode=UR -w <工程产物>.hex -v -rst
```

- 探针没枚举时先查 ST-Link 是否还在设备列表里，别反复重试命令。
- 只关整车/板级电源而 USB 仍给 MCU 供电时，MCU 并没有真正复位；需要清状态就断 USB 或按复位。

## 3. 中断必须单独验收（踩过的坑）

工程若开启 `--cpp11`，`.c` 会按 C++ 编译，startup 向量表引用的 ISR 必须保持 C 链接：

- 把 ISR 声明放进 `extern "C"`（header 里声明，或定义处整体包住）；
- 否则符号被 mangle，向量表仍指向 `Default_Handler`；
- 典型现象：**串口能打印、外设配置和 CAN 都正常，但某个中断永远不触发**；
- **0 Error 不等于中断可用**：用 `fromelf -s` 或 map 文件确认 `USARTx_IRQHandler` / `TIMx_IRQHandler`
  指向独立地址，而不是与其它弱符号共用的 `Default_Handler`。

排查顺序：先确认向量表，再查外设接收/触发逻辑。UART 类验收看原始字节计数，不要只看是否编译通过。

## 4. 文档同步（项目硬要求）

改动后立即更新工程内的 `使用说明.md` 与 `工程搭建指南.txt`：

- 引脚表、定时器分配、软件架构、构建步骤、PID 参数、故障排查都要覆盖；
- **参数必须从当前源码读取后写入**（通常在 `App/Inc/*.h`），禁止从记忆或别的工程抄。

## 验收清单

- [ ] Keil 0 Error / 0 Warning
- [ ] PC 侧测试全部通过
- [ ] 新加/改动的中断在 map 中有独立地址
- [ ] `使用说明.md`、`工程搭建指南.txt` 与当前源码一致
