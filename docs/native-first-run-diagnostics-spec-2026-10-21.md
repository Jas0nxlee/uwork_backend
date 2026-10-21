# FirstRun测试故障诊断

现有FirstRunUi在任意异常后停止后续输入，且隐藏异常原文以避免身份/凭据外泄。原实现也吞掉自身固定准入码，使控制未就绪、错误引导步骤、预算异常与CDP传输异常都只剩同一句错误；这会误导后续故障归类。

保留原错误消息、单次action claim和失败后停止行为，增加只含固定枚举的diagnostic：请求phase（未知值统一unknown）、mode（固定枚举）、失败stage（observe/validate/input/result）、causeCode（仅本模块内已定义require码）、causeType（固定异常类别，其他统一Exception）。不输出异常原文、路径、URL、HTML或凭据；不增加重试、不放宽边界。受控测试证明同一旧消息下可区分原准入错误与超时，任意异常字符串不会进入诊断。
