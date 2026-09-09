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
| Il **testo** di dodici tratti di razza su 46, nel 2014 | Le sottorazze ci sono tutte — il pacchetto le porta, e i test lo verificano: quello che manca sono le loro *descrizioni*. L'SRD 5.1 pubblica il testo di una sola sottorazza per razza, quindi elfo scuro, elfo dei boschi, gnomo delle foreste, nano delle montagne e halfling tozzo restano senza. Undici mancano alla fonte; il dodicesimo — il linguaggio extra dell'umano — è nell'SRD sotto «Linguaggi» e non si aggancia perché il builder lo chiama in un altro modo: quello è un buco nostro |
| Dodici background su tredici, nel 2014 | L'SRD 5.1 pubblica solo l'accolito. Gli altri sono del *Player's Handbook* |
| Gli antenati draconici del 2024 | La tabella dà solo il tipo di danno, che il nome del tratto già dice per intero («Antenato Draconico: Nero (Acido)»). Una descrizione di due parole sarebbe rumore |
| Apocalisse (Acheron Games) | Materiale protetto, spedito senza testi: nomi, struttura e numeri, quanto basta a leggere una scheda già creata. `tests/unit/varianti-senza-testo.test.js` fa la guardia |

## Brancalonia

Il pacchetto `brancalonia` porta i testi dei manuali di Acheron Games. **Non è materiale libero** e non è
CC-BY: la decisione di spedirlo è del proprietario del progetto, che possiede i manuali, e l'attribuzione nel
registro lo dice per esteso.

Sopra ci poggia `brancalonia-brainstorm`, che non viene da un manuale ma da un tavolo: il *Grimorio di Bassa
Lega*, le regole di casa della campagna «L'Impero Randella Ancora». Porta i venti incantesimi del Regno con il
testo della campagna — riassunto di proposito, «in caso di dubbio fa fede il manuale» — e la magia scadente in
forma leggibile da un programma, così l'app la può *fare* invece di mostrarla soltanto. È la prima catena a
tre del registro: brainstorm → brancalonia → srd-2014.

Il grimorio e il builder chiamano gli stessi incantesimi in modo diverso, e **è il grimorio ad avere
ragione**: usa i nomi stampati sui manuali — «Dito della Sorte», «Emettere Fattura», «Mondare» — mentre il
builder ne ha coniati di suoi che in nessun manuale compaiono («Dito del Fato», «Chex», «Bonificare»). Otto
nomi su quattordici divergono, e il caso più visibile è *Bonificare*, il cui testo estratto dal manuale
**cita sé stesso** col nome giusto: «un'area sotto l'effetto di un incantesimo *mondare*».

Il generatore li appaia per livello e classi — i due dati che nessuna traduzione cambia — con la scuola a
sciogliere gli ex aequo, e **si ferma** invece di indovinare quando restano due candidati. Da lì è uscito un
errore del builder: *Storia Spaventosa* vi era classificata come Trasmutazione mentre il Macaronicon la dà
come Ammaliamento, ed è stato corretto a monte.

## Le tabelle stampate dentro un incantesimo

Tre incantesimi del 2024 — *Teletrasporto*, *Spruzzo prismatico*, *Muro prismatico* — hanno una tabella
stampata in mezzo al testo. L'estrattore legge il PDF a due colonne e quelle celle finiscono intrecciate alla
prosa: la tabella del teletrasporto esce colonna per colonna e non è più leggibile, e in due casi una parola
resta spezzata da un numero di riga («il bersaglio è tratte- / 6 / nuto»).

È l'unico difetto di estrazione noto e non risolto, ed è dichiarato invece che nascosto: un test fissa
l'elenco di quei tre, così non può allungarsi in silenzio. Prima erano diciannove, ma gli altri sedici erano
sillabazione ordinaria e sono stati ricongiunti.

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
