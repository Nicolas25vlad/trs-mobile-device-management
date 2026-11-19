# Política de segurança

## Versões suportadas

| Versão | Suporte |
|---|---|
| 0.7.x | ✅ |
| < 0.7 (dentro do game-trs) | ❌ |

## Como reportar uma falha

**Não abra uma issue pública com detalhes da falha.**

- Use **Security → Report a vulnerability** neste repositório no GitHub.
- Se a opção não estiver disponível, abra uma issue curta, sem detalhes, pedindo um canal privado.

Ajuda muito incluir:
- o que é possível fazer (ex.: entrar sem autorização, derrubar o servidor, ler arquivos);
- passos para reproduzir;
- versão ou commit e sistema usado.

## Escopo

O servidor foi feito para a **rede local**. Ele protege contra:
- outros aparelhos da mesma rede entrando sem autorização (PIN, bloqueio por tentativas, autorização no computador, um pedido por aparelho);
- mensagens malformadas ou em excesso;
- acesso a arquivos fora das pastas servidas.

Ele **não** usa HTTPS e não foi feito para ficar exposto na internet. Expor a porta no roteador está fora do escopo suportado.
