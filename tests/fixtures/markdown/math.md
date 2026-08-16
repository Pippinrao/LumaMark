# Math source fidelity 数学源码保真

Pandoc inline math keeps ordinary text around $E = mc^2$ and CJK around $\alpha + \beta$ 中文。

Escaped dollars stay literal: \$19.99 and \$not-math\$.

Inline code stays opaque: `$not_math$` and ``code $$ still code``.

$$
\int_0^1 x^2\,dx = \frac{1}{3}
$$

> A quoted equation follows.
>
> $$
> \sum_{n=1}^{\infty}\frac{1}{n^2}=\frac{\pi^2}{6}
> $$

- A list equation:

  $$
  \begin{aligned}
  a &= b + c \\
  d &= e - f
  \end{aligned}
  $$

Forward reference $\eqref{eq:future}$ appears before its labeled equation.

$$
\begin{equation}
e^{i\pi}+1=0
\label{eq:euler}
\end{equation}
$$

Backward reference $\ref{eq:euler}$ and another forward reference $\ref{eq:future}$ stay in source order.

$$
\begin{equation}
F = ma
\label{eq:future}
\end{equation}
$$

Define a document macro at this position:

$$
\newcommand{\vect}[1]{\mathbf{#1}}
\vect{x}
$$

The later formula uses the macro: $\vect{v}=\vect{u}+\vect{w}$.

Chemistry is locally available: $\ce{H2O + CO2 -> H2CO3}$.

Physics package source is preserved even when its preference is disabled: $\dv{x}{t}$ and $\qty(\frac{a}{b})$.

An invalid closed formula remains editable:

$$
\frac{1}{
$$

An unclosed block remains a draft and must never replace its source:

$$
\sqrt{draft}
