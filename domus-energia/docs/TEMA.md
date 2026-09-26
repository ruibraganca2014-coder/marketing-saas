# Tema visual da Domus Energia — "Terra"

Substitui o verde e branco anterior. Aplica-se ao site público, à área de cliente web e à app Android.
Ambiente calmo e terroso: uma casa acolhedora, não um painel industrial.

## Paleta
| Token | Claro | Escuro | Uso |
|---|---|---|---|
| `--fundo` | `#fefae0` creme | `#1a2310` floresta noturna | fundo da página |
| `--superficie` | `#fffdf0` | `#283618` floresta profunda | cartões |
| `--texto` | `#283618` floresta profunda | `#fefae0` creme | texto principal |
| `--texto-suave` | `#5c6446` | `#c9c7a8` | texto secundário |
| `--borda` | `#e6e0bf` | `#3a4a26` | contornos finos |
| `--musgo` (primária) | `#606c38` | `#8a9a5b` | botões, interruptores ligados, links |
| `--musgo-claro` | `#eef0d9` | `#34441f` | fundos de ícones, estados suaves |
| `--areia` | `#dda15e` | `#dda15e` | destaques, avisos, bateria fraca |
| `--argila` | `#bc6c25` | `#d9853b` | acento quente, consumo alto, CTA secundário |
| `--alarme` | `#a4372a` | `#e0705f` | alarme e erros (não é a cor da marca) |

- Modo escuro: segue o sistema (`prefers-color-scheme`) e respeita `data-theme="light|dark"`; na app Android segue o tema do sistema.
- Texto sobre `--musgo` usa creme `#fefae0`.

## Letra
- Títulos: **Alegreya Sans** (700/800), humanista e suave. Fallback: `"Gill Sans", "Segoe UI", sans-serif`.
- Texto: **Nunito Sans** (400/600/700). Fallback: `system-ui, "Segoe UI", Roboto, sans-serif`.
- Números (W, V, A, kWh, %): Nunito Sans com `font-variant-numeric: tabular-nums`.
- Android: as mesmas famílias via Google Fonts downloadable fonts (`androidx.compose.ui:ui-text-google-fonts`) com fallback para a sans do sistema.

## Formas
- Raio: 18 px nos cartões, 999 px em botões e interruptores. Sombras muito leves e quentes (`rgba(40,54,24,.08)`), só nos cartões.
- Interruptores: pista `--borda` desligado, `--musgo` ligado; botão creme.

## Fundo vivo (área de cliente)
O fundo é um gradiente suave que muda devagar (transição de 4 s) consoante o estado da casa:
- `calor` = potência total / 3500 W (limitado a 0–1); `luzes` = fração de interruptores/luzes ligados.
- Gradiente: do topo `mix(--fundo, --musgo-claro, luzes)` para baixo `mix(--fundo, --areia, calor * .35)`; com `calor` > .8 um toque de `--argila` no canto inferior.
- Alarme ativo: um halo muito leve de `--alarme` no topo.
- Nunca muda a legibilidade: o contraste do texto mantém-se AA.

## Ilustrações animadas
Cada função de canal tem um pequeno desenho SVG feito à mão (traço 2 px, cores dos tokens), 48–56 px, que se anima **só quando está ativo**, de forma subtil:
| Função | Desenho | Animação quando ativo |
|---|---|---|
| `interruptor` | lâmpada de filamento | brilho quente (`--areia`) a pulsar muito devagar |
| `luz` | candeeiro com raios | raios com opacidade = brilho; leve cintilar |
| `estore` | janela com lâminas | lâminas deslizam para a posição atual |
| `porta` | porta de madeira (`--argila`) | abre-se na perspetiva quando aberta |
| `movimento` | figura/ondas concêntricas | ondas expandem-se durante 3 s após movimento |
| `bateria` | pilha | nível preenche; pisca em `--areia` se < 15 % |
| medidor (`medidor: true`) | raio num círculo | pulso cuja velocidade acompanha a potência |
- Respeitar `prefers-reduced-motion` (sem animação, só o estado final). Android: desativar animações se a escala de animações do sistema for 0.

## Site público
Mesma paleta e letra. Hero com fundo creme e uma ilustração de casa em traço (`--musgo`) com janelas acesas em `--areia`; botões principais `--musgo`, WhatsApp mantém o verde oficial só no botão flutuante.
