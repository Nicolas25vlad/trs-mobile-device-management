# Como contribuir

Obrigado por ajudar! Este guia é curto de propósito.

## Ambiente

1. Clone este repo e o [game-trs](https://github.com/Traficas-Revolution-Soccer/game-trs) lado a lado.
2. Rode `node server/server.js --game ../game-trs` e abra o endereço mostrado.
3. Para testar o celular sem um aparelho, use o modo de dispositivo móvel do navegador em `/controller/`.

Node.js 18+ roda o servidor. Os testes precisam do Node.js 22+ (WebSocket nativo).

## Regras do projeto

- **Sem dependências.** O servidor usa só módulos do Node, e o cliente é JavaScript puro, sem etapa de build. O jogo é publicado como um único HTML offline, e isso precisa continuar funcionando.
- **Siga o estilo do código ao redor:** compacto, comentários em português explicando o *porquê*.
- **Segurança primeiro.** Toda mensagem vinda da rede é validada no servidor, e o anfitrião continua tendo a palavra final.
- **Latência importa.** Nada de trabalho pesado nos eventos de toque nem no caminho do pacote.
- **Mudou o protocolo?** Atualize o [docs/PROTOCOL.md](docs/PROTOCOL.md).

## Testes

```bash
npm test
```

Todo comportamento novo precisa de teste:
- **Protocolo ou servidor:** `tests/server.test.cjs`, que sobe um servidor de verdade.
- **QR:** `tests/qr.test.cjs`. Se a matriz de referência mudar, confira de novo com um decodificador real (ex.: jsQR) antes de atualizar o hash.

## Commits e pull requests

- Mensagens no formato [Conventional Commits](https://www.conventionalcommits.org/pt-br/): `feat:`, `fix:`, `docs:`, `test:`, `refactor:`, `chore:`.
- Um assunto por pull request, com uma descrição do que mudou e de como foi testado.
- Atualize o [CHANGELOG.md](CHANGELOG.md) na seção da próxima versão.
