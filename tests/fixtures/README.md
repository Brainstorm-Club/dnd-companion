# Fixture

Personaggi nel formato che il builder esporta (`CharacterData`), usati dai test.

| File | Serve a |
|---|---|
| `dnd2024-mago-5.json` | edizione 2024, incantatore pieno, slot e incantesimi preparati |
| `dnd5e-guerriero-3.json` | edizione 2014, senza magia, armatura pesante e velocità ridotta |
| `brancalonia-rifiuto.json` | provare che l'import **si rifiuti con garbo**: nessun pacchetto lo copre in v1 |

Sono scritti a mano sulla forma reale di `CharacterData`. Quando i lotti avranno bisogno di casi più cattivi —
livello 20 multiclasse, campi mancanti — si generano dal builder riusando il suo `randomCharacter.ts`, così
restano allineati al formato vero invece di essere la nostra idea di come dovrebbe essere.

## Export veri dal builder

Generati col «🎲 Casuale» del builder in esecuzione (dev server :5174) e letti da
`localStorage['character'].character` — lo stesso oggetto che `downloadJson()` serializza.
Non sono scritti a mano: è esattamente ciò che l'app riceverà.

| File | Perché è utile |
|---|---|
| `reale-dnd2024-guerriero-3.json` | edizione 2024, maestria d'arma, talento d'origine (`savage-attacker`), armatura pesante |
| `reale-dnd5e-barbaro-10.json` | livello 10, **nessuna armatura ma con scudo** (Difesa Senza Armatura): il caso che fa sbagliare la CA |
| `reale-dnd5e-chierico-3.json` | incantatore vero: 3 trucchetti e 6 incantesimi con gli id inglesi che il ponte deve agganciare |

Tre cose che i dati veri mostrano e le fixture scritte a mano nascondevano:

1. **`featuresTraits` mescola id e nomi**: `"extra-language"`, `"draconic-ancestry"` accanto a `"Rage"` e
   `"Spellcasting"`. La scheda non può stamparli così com'è.
2. **Ci sono duplicati**: il barbaro di 10° ha due volte `"Ability Score Improvement"` e due volte
   `"Primal Path feature"`.
3. **`armor: ""` con `shield: true`** è uno stato normale, non un errore: la CA va calcolata da Destrezza
   (più Costituzione, per il barbaro) e lo scudo.
