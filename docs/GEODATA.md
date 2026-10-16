# Географски данни и външни услуги

| Данни | Източник | Лиценз / условия | Как се ползва |
|-------|----------|------------------|---------------|
| Държави, градове (≥15 000 жители), административни области, пристанища, български имена | [GeoNames](https://www.geonames.org) dumps | CC BY 4.0 — търговска употреба с атрибуция | Извлечен поднабор в `data/geo/launch-region.json` (комитнат), импортира се в PostgreSQL |
| Пътни маршрути за камиони | [Valhalla](https://github.com/valhalla/valhalla) върху OpenStreetMap; публична инстанция на FOSSGIS | ODbL (данни OSM), политика за умерена употреба на инстанцията | Чрез `src/server/geo/routing.ts`, кеш в таблица `routes` |
| Картни плочки и стил | [OpenFreeMap](https://openfreemap.org) (OpenMapTiles схема, OSM данни) | Безплатно, без ключ, позволява търговска употреба; изисква атрибуция | MapLibre GL в браузъра; стилът се задава с `NEXT_PUBLIC_MAP_STYLE_URL` |

Атрибуцията се показва в долния колонтитул на сайта и в ъгъла на картата.

## Обхват
`src/lib/geo/scope.ts`: BG, RO, GR, TR, RS, MK, HU, AT, DE (2 179 града, 97 пристанища). Моделът е глобален — за нови държави се добавя кодът и се изпълнява `scripts/build-geo-dataset.ts`.

## Обновяване на набора
```bash
mkdir -p data/raw && cd data/raw
curl -O https://download.geonames.org/export/dump/cities15000.zip
curl -O https://download.geonames.org/export/dump/countryInfo.txt
curl -O https://download.geonames.org/export/dump/admin1CodesASCII.txt
for c in BG RO GR TR RS MK HU AT DE; do
  curl -o alt_$c.zip https://download.geonames.org/export/dump/alternatenames/$c.zip
  curl -o all_$c.zip https://download.geonames.org/export/dump/$c.zip
done
for f in *.zip; do unzip -oq $f -d ${f%.zip}; done
cd ../.. && pnpm tsx scripts/build-geo-dataset.ts && pnpm geo:import
```

## Реално срещу симулирано
- **Реално:** държави, ISO кодове, имена, координати, население (по GeoNames), пристанища, пътни разстояния/времена, тол участъци, гранични преходи (Valhalla).
- **Симулирано (игрови данни):** какво „произвежда“ и „търси“ всеки град, нивото на търсене, пазарните събития, възложителите (измислени фирми), цените. В интерфейса тези данни са обозначени като игрови.

## Маршрутизация — поведение
- Профил `truck`: височина 4 м, ширина 2.55 м, дължина 16.5 м, 40 т, 11.5 т на ос.
- Началната/крайната точка се „закачват“ за път от клас secondary или по-висок (до 3 км) — центровете на много градове са забранени за тежкотоварни.
- Граничните преходи идват от `admin_crossings` на Valhalla с точната им позиция по маршрута.
- При грешка/недостъпност → `provider = 'approximate'` (голям кръг × 1.25), визуализира се като пунктир и надпис „приблизително“. Worker-ът опитва да ги надгради на всеки 15 минути.
