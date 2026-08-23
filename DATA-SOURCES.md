# Da dove vengono i dati

L'app spedisce **solo materiale SRD**, sotto Creative Commons. Niente Player's Handbook, niente manuali di
altri editori: ciò che non si può ridistribuire non viene ridistribuito, e dove manca il testo l'app lo dice.

## D&D 2014 — SRD 5.1

Fonte: **System Reference Document 5.1**, edizione italiana, Wizards of the Coast, **CC-BY-4.0**.
Contiene 319 incantesimi (24 trucchetti), le classi con i loro privilegi, le condizioni e l'equipaggiamento.

Due assenze da conoscere: l'**Appendice A è mutila** — Prono, Spaventato, Stordito e Trattenuto non ci sono, e
nei nostri dati restano senza testo invece di essere inventate o prese dal 2024, che ha regole diverse. E venti
privilegi di sottoclasse non hanno una traduzione italiana disponibile: stessa scelta, `description: null`.

> Questo lavoro include materiale del System Reference Document 5.1 (“SRD 5.1”) di Wizards of the Coast LLC
> disponibile al sito https://dnd.wizards.com/it/resources/systems-reference-document. L'SRD 5.1 è concesso in
> licenza sotto l'Attribuzione 4.0 Internazionale di Creative Commons disponibile al sito
> https://creativecommons.org/licenses/by/4.0/legalcode.it.

## D&D 2024 — SRD 5.2.1

Fonte: **System Reference Document 5.2.1**, traduzione ufficiale italiana pubblicata nel dicembre 2025,
Wizards of the Coast, **CC-BY-4.0**. Contiene 339 incantesimi (27 trucchetti e 312 livellati), le dodici classi
con una sottoclasse ciascuna, i talenti, la maestria d'arma.

> Quest'opera include materiale tratto dal System Reference Document 5.2.1 ("SRD 5.2.1") di Wizards of the Coast
> LLC, disponibile all'indirizzo https://www.dndbeyond.com/srd. Il SRD 5.2.1 è concesso in licenza ai sensi
> della licenza di attribuzione 4.0 Internazionale di Creative Commons, disponibile all'indirizzo
> https://creativecommons.org/licenses/by/4.0/legalcode.

## Cosa **non** c'è, e perché

| Materiale | Perché manca |
|---|---|
| *Blade Ward* e *Hex* | Sono del *Player's Handbook*, non dell'SRD 5.1. L'app ne mostra il nome, senza testo. Sono gli unici due dei 317 incantesimi del builder che il ponte non aggancia — il builder ne dichiara tredici fuori SRD, ma sui dati veri i non agganciati sono due |
| Sottoclassi oltre a quella per classe dell'SRD | Idem |
| Brancalonia, Apocalisse (Acheron Games) | Materiale protetto. Arriveranno come pacchetti scaricabili, con la loro posizione di licenza |

## I PDF

Non stanno in questo repository e non ci staranno: `.gitignore` esclude `*.pdf`. Si committa solo il JSON
generato da `scripts/build-spells.mjs`, che documenta da dove si scaricano i documenti originali.

## Le liste di classe del 2014

L'SRD 5.1 non mette le classi nell'intestazione dell'incantesimo, come fa invece il 5.2.1: le tiene in liste
separate per classe, più avanti nel documento. Il campo `classi` dei record 2014 viene **da quelle liste**, non
dal builder: coprono tutti e 319 gli incantesimi (il builder ne ha 317) e sono la fonte autorevole.

## Come sono stati estratti

`pdftotext` **senza** `-layout` mette le colonne nell'ordine di lettura giusto quasi ovunque, ma non basta: su
una decina di pagine per edizione il riquadro colorato dell'intestazione di scuola esce dal flusso e finisce a
valle del corpo, attaccando a un incantesimo l'intestazione di quello dopo. L'estrazione usa quindi
**`-bbox-layout`**, ricostruendo le colonne dalle coordinate — che restituisce anche i rientri di capoverso,
che l'estrazione piatta butta via.

Il generatore si ferma **prima di scrivere** se il numero di intestazioni non coincide con quello dei blocchi di
campi, e i test verificano sui JSON prodotti che non sopravviva nemmeno una riga di piè di pagina: dal 5.1 ne
sono state tolte 1006, dal 5.2.1 810.
