# Protocolo do WebSocket

Todas as mensagens são JSON em quadros de texto no endpoint `/ws`, com um campo `t` (tipo). Há dois papéis:
- **anfitrião** (`host`): o jogo no computador;
- **controle** (`ctrl`): o celular.

O servidor só repassa o que está listado aqui e descarta o resto.

## Limites

| | Valor |
|---|---|
| Controles por sessão | 4 (pendentes incluídos) |
| Validade do PIN | 10 min |
| Duração máxima da sessão | 4 h |
| Reconexão do controle | 90 s (depois disso o pedido ou o controle sai da sessão) |
| Reconexão do anfitrião | 5 min |
| Tentativas de PIN | 5 por minuto por IP; depois, bloqueio de 2 min |
| Pacotes `in` | 90/s por controle (balde de fichas) |
| Tamanho da mensagem | 4 KB |

## Anfitrião → servidor

| `t` | Campos | Efeito |
|---|---|---|
| `host-create` | | Cria uma sessão (encerra a anterior deste anfitrião) |
| `host-resume` | `id`, `hostToken` | Retoma a sessão depois de recarregar a página |
| `approve` | `cid` | Autoriza um controle pendente (ignorado se já autorizado) |
| `deny` | `cid` | Recusa. O aparelho e o IP ficam impedidos de pedir de novo nesta sessão |
| `kick` | `cid` | Desconecta um controle |
| `to-ctrl` | `cid`, `msg` | Envia ao controle. `msg.t` só pode ser `state`, `rumble` ou `hello` |
| `host-close` | | Encerra a sessão e desconecta todos |
| `ping` | `ts` | Responde `pong` |

## Servidor → anfitrião

| `t` | Campos | Quando |
|---|---|---|
| `session` | `id`, `pin`, `hostToken`, `expires`, `urls[]` | Sessão criada ou retomada. `urls` vem com o endereço mais provável de ser o Wi-Fi primeiro |
| `pair-request` | `cid`, `name` | **Uma vez** por aparelho e por sessão |
| `ctrl-state` | `cid`, `name`, `label`, `state` | `pending`, `connected`, `reconnecting` ou `gone` |
| `ctrl-in` | `cid`, `s`, `x`, `y`, `b` | Comando repassado (ver formato abaixo) |
| `ctrl-rtt` | `cid`, `rtt` | Latência ida e volta medida pelo celular |
| `session-ended` | `why` | Sessão encerrada |
| `error` | `code`, `msg` | `session`: sessão expirada |
| `pong` | `ts` | |

## Controle → servidor

| `t` | Campos | Efeito |
|---|---|---|
| `join` | `pin`, `name`, `dev` | Pede autorização. `dev` é o ID aleatório do aparelho (32 hex). Repetir reaproveita o mesmo pedido |
| `resume` | `sid`, `cid`, `token` | Reconecta um controle autorizado |
| `in` | `s`, `ts`, `x`, `y`, `b` | Estado do controle (só depois de autorizado) |
| `ping` | `ts` | Responde `pong` |
| `rtt` | `rtt` | Informa a latência ao anfitrião |

## Servidor → controle

| `t` | Campos | Quando |
|---|---|---|
| `wait-approval` | `cid`, `again?` | Pedido na fila. `again: true` quando reaproveitado |
| `paired` | `sid`, `cid`, `token`, `label`, `resumed?` | Autorizado (ou reconectado) |
| `denied` | | O anfitrião recusou |
| `kicked` | | O anfitrião desconectou este controle |
| `replaced` | | Outra aba do mesmo aparelho assumiu. Esta não deve reconectar |
| `session-ended` | `why` | Sessão encerrada |
| `host-away` / `host-back` | | Computador caiu ou voltou |
| `state` | `label`, `side`, `poss`, `hasBall`, `attack`, `player` | Posse de bola e contexto dos botões. Enviado só quando muda (verificado a cada 50 ms) |
| `rumble` | `ms` | Vibrar |
| `hello` | `label` | Identificação do controle |
| `error` | `code`, `msg` | `blocked`, `pin`, `full`, `denied` ou `resume` |
| `pong` | `ts` | |

## Formato do comando (`in` / `ctrl-in`)

| Campo | Tipo | Faixa |
|---|---|---|
| `s` | inteiro crescente | pacotes com `s` menor ou igual ao último são descartados |
| `x`, `y` | número | −1 a 1 (`y` positivo para baixo) |
| `b` | inteiro, máscara de bits | 0 a 1023 |

Bits de `b`, do bit 0 ao 9: `pass`, `shoot`, `cross`, `through`, `sprint`, `switch`, `skill`, `tackle`, `support`, `pause`.

O celular envia:
- **na hora**, a cada aperto ou soltura de botão;
- **até ~60/s** enquanto o analógico se move;
- **a cada 100 ms** como sinal de vida.

O jogo zera o comando de um controle sem pacote há 800 ms.

## Posse de bola (`state.poss`)

| `poss` | Quando | `attack` |
|---|---|---|
| `mine` | Eu estou com a bola, ou sou quem cobra a bola parada | `true` |
| `team` | Companheiro com a bola, ou bola parada do meu time | `true` |
| `opp` | Adversário com a bola, ou bola parada dele | `false` |
| `loose` | Bola sem dono | `true` se o último toque foi do meu time |
| `idle` | Fora da partida (menu). Só `label` vem junto | |

## Link de pareamento

```
http://IP-DO-PC:PORTA/controller/#pin=123456
```

O PIN vai no fragmento (`#`): o navegador não o envia ao servidor, e o controle o apaga da barra de endereço ao ler.
