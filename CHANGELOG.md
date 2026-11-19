# Changelog

Todas as mudanças relevantes deste projeto ficam aqui.
O formato segue o [Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/) e o projeto usa [Versionamento Semântico](https://semver.org/lang/pt-BR/).

## [0.7.0] - 2026-11-19

Primeira versão como repositório próprio. O controle saiu do [game-trs](https://github.com/Traficas-Revolution-Soccer/game-trs), onde existia desde a 0.6.

### Adicionado
- **QR code de pareamento.** Gerador próprio, sem dependências (`client/qr.js`: modo byte, nível M, versões 1–10). O link leva o PIN no fragmento (`#pin=…`), e o celular conecta sozinho e apaga o PIN da barra de endereço.
- **Escolha do endereço do QR** quando o computador tem várias redes. O servidor lista primeiro o endereço com mais cara de Wi-Fi.
- **Um pedido de autorização por aparelho e por sessão.** Recarregar, ler o QR de novo ou apertar CONECTAR reaproveita o pedido. O aparelho é reconhecido por um ID aleatório e, sem ele, pelo IP.
- **Recusa vale para a sessão inteira**, mesmo trocando o ID. Só um NOVO PIN libera.
- **Aparelho já autorizado** que volta entra direto, sem pedir de novo.
- **Tela cheia e horizontal automáticas:** o controle gira 90° na hora com o celular em pé e entra em tela cheia no primeiro toque permitido pelo navegador. Opção nas configurações.
- **Pedido mantido** quando a aba recarrega ou a conexão cai enquanto espera a autorização.
- Opção `--game PASTA` (ou `TRS_GAME_DIR`): o servidor serve o jogo de outra pasta. O cliente do jogo fica em `/mobile/`.
- Documentação do protocolo (`docs/PROTOCOL.md`), testes do QR e integração contínua.

### Alterado
- **Botões enviados na hora**, no próprio evento de toque, sem esperar o limite de 15 ms do analógico.
- O IP do cliente vem do socket. `X-Forwarded-For` só com `TRS_TRUST_PROXY=1`.

### Corrigido
- **Toque curto no celular se perdia** no jogo quando apertar e soltar chegavam entre dois quadros (correção no `game-trs`, em `js/input/input.js`).
- O aviso "Gire o celular" nunca aparecia (seletor CSS errado). Foi substituído pelo giro automático.
- Ler o QR de novo com a página aberta não fazia nada: o navegador só troca o `#`, sem recarregar.
- Um pedido pendente que caía sumia da lista do computador e obrigava a pedir de novo.
- Os celulares da sessão anterior continuavam na lista do computador depois de um NOVO PIN.
- Uma URL com escape inválido (ex.: `/%E0%A4%A`) lançava uma exceção que derrubava o servidor. Agora responde 400.

[0.7.0]: https://github.com/Traficas-Revolution-Soccer/trs-mobile-device-management/releases/tag/v0.7.0
