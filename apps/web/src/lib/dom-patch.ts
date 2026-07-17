'use client'

/**
 * Mitigação para um bug conhecido do React (facebook/react#11538): quando
 * algo fora do controle do React mexe na árvore DOM — autofill/gerenciador
 * de senha do navegador injetando UI num campo de formulário, extensões,
 * tradutor automático — ele pode remover ou mover um nó que o React ainda
 * acha que está lá. No próximo commit, removeChild/insertBefore lançam
 * NotFoundError ("Failed to execute 'removeChild' on 'Node': The node to
 * be removed is not a child of this node"), que sobe como crash fatal da
 * página inteira via app/error.tsx — mesmo não sendo um bug de lógica da
 * aplicação, e sim uma corrida com o navegador.
 *
 * Padrão de correção documentado para esse issue: só executar a operação
 * nativa se o nó realmente ainda for filho do pai esperado; caso
 * contrário, é um no-op seguro (a operação já não faria sentido de
 * qualquer forma).
 */
if (typeof window !== 'undefined' && typeof Node === 'function' && Node.prototype) {
  const originalRemoveChild = Node.prototype.removeChild
  Node.prototype.removeChild = function <T extends Node>(this: Node, child: T): T {
    if (child.parentNode !== this) {
      if (process.env.NODE_ENV !== 'production') {
        console.warn('[dom-patch] removeChild ignorado: nó já não é filho deste pai', child, this)
      }
      return child
    }
    return originalRemoveChild.call(this, child) as T
  }

  const originalInsertBefore = Node.prototype.insertBefore
  Node.prototype.insertBefore = function <T extends Node>(this: Node, newNode: T, referenceNode: Node | null): T {
    if (referenceNode && referenceNode.parentNode !== this) {
      if (process.env.NODE_ENV !== 'production') {
        console.warn('[dom-patch] insertBefore ignorado: nó de referência já não é filho deste pai', referenceNode, this)
      }
      return newNode
    }
    return originalInsertBefore.call(this, newNode, referenceNode) as T
  }
}
