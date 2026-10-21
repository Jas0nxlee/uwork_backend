# 原文件摘要的独立撤销与晚到冲突

独立PREPUBLISH_FILE_ONLY_REWIND=1（与PREPUBLISH_REWIND_FILES=1搭配），原Read/Write和一次审批仅作变更前置。原文件摘要“撤销”打开真实预检；关闭预览不写文件或推理。再次预检为safe后，在本case外部编辑器改写同一文件，再点原“撤销文件”：Core应拒绝写入，UI必须保留弹框、展示返回的当前unsafe preview与失败信息，禁止把accepted/duplicate命令收据当applied=true。

文件和完整账本/供应商/原问题回答保持；对话不能被此文件命令裁剪。关闭错误弹框、外部编辑器撤销自己的改动后重新打开原预检，明确确认才恢复原始字节，原摘要显示已撤销/按钮禁用。reload不重放，当前成员一直4笔88Credit、另一成员完整账本保持。仅补独立文件撤销消费者，不重跑组合编辑/Fork/队列/批删。
