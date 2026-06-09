# Zadání

Potřebujeme nástroj, kterým budeme kontrolovat, že nikdo nepovolaný nemá přístup k našim skupinám a projektům v Gitlabu.

Stačí aby se nástroj spouštěl co nejjednodušším způsobem, kde dostane jako argument ID top-level skupiny pomocí formuláře a vypíše výsledek v lidsky čitelném formátu.

Access token nebude předáván jako argument spouštěného příkazu, ale měl by být snadno vyměnitelný. Jak splnit tento požadavek je ponecháno na řešiteli.

## Jak fungují Gitlab skupiny, projekty a uživatelé

- skupiny mohou být do sebe libovolně vnořovány, není omezena hloubka
- projekty jsou vždy v nějaké skupině, nic jako sub-projekty neexistuje
- uživatelé mohou být členy skupin i projektů

## Potřebná data ve výstupu

- výstup by měl být seznam uživatelů s detaily (viz další bod)
- k uživatelům potřebujeme vědět
    - občanské jméno (tzn. jméno a příjmení)
    - uživatelské jméno
    - seznam skupin jejichž je členem a s jakým oprávněním (pouze v rámci vstupního ID skupiny nebo podskupin)
    - seznam projektů jejichž je členem a s jakým oprávněním (pouze v rámci vstupního ID skupiny nebo podskupin)
- na konci výstupu by měl být celkový počet uživatelů

## Ukázkový výstup

Na testovacím prostředí by měl nástroj dát tato data. Formát není nutné zachovat, ale chceme, aby byl nástroj reálně použitelný, tedy měl by být podobně čitelný.

```
Jan Konáš (@jan.konas)
Groups:    [apploud-external/testovaci-zadani (Owner)]
Projects:  []

Jan Konáš (@jankonas1)
Groups:    [apploud-external/testovaci-zadani (Owner)]
Projects:  []

Michal Pham (@KhanhPhams)
Groups:    [apploud-external/testovaci-zadani/skupina-3 (Guest)]
Projects:  [apploud-external/testovaci-zadani/uloha-1 (Guest)]

Martin Špicar (@martin.spicar)
Groups:    []
Projects:  [apploud-external/testovaci-zadani/uloha-1 (Developer), apploud-external/testovaci-zadani/skupina-2/skupina-4/projekt-3 (Guest), apploud-external/testovaci-zadani/skupina-3/projekt-2 (Guest)]

Michal Bílý (@MichalBily)
Groups:    [apploud-external/testovaci-zadani/skupina-1 (Guest)]
Projects:  []

Total Users: 5
```

## Škálovatelnost

Testovací prostředí má 5 uživatelů, 5 skupin (včetně top-level) a 4 projekty. Nástroj ale musí fungovat i na reálném prostředí, které má okolo 500 projektů, nižší desítky skupin a kolem 50 uživatelů.

# Přístupové údaje a další informace k vývoji

Pro vývoj je k dispozici read-only testovací prostředí s těmito údaji:

- ID top-level skupiny: `10975505`
- Access token: `YOUR_TOKEN_HERE`

Je potřeba využít Gitlab REST API, nikoli GraphQL. Jeho dokumentace je zde: https://docs.gitlab.com/ee/api/

Gitlab API nabízí endpoint https://docs.gitlab.com/api/users/#list-projects-and-groups-that-a-user-is-a-member-of , ke kterému ovšem nemáte administrátorský access token. Principem úkolu je porozumění API, stažení dat a jejich spojení. 