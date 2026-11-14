# 酱菜通中期实验报告

- `JiangCaiTong_Midterm_Report.pdf` 为提交版 PDF。
- `main.tex`、`sections/`、`figures/` 与 `references.bib` 为可编辑源文件、图件和参考资料。
- 封面姓名、学号及课程可在 `main.tex` 顶部的三个对应宏中修改。运行成果位于项目的 `android/dist/JiangCaiTong-0.9.3-debug.apk`。

在本目录使用 TeX Live 执行以下命令，所需中文字体由 Fandol 提供。

```powershell
latexmk -xelatex -interaction=nonstopmode -halt-on-error -jobname=JiangCaiTong_Midterm_Report main.tex
```
