# startpage

## Weather widget

The start page (`index.html`) shows the current temperature and conditions. It defaults to Dublin, Ireland and switches to "Your location" if the visitor allows geolocation. The °C/°F choice is remembered in `localStorage`. Coordinates are rounded and never stored.

Data comes from [Open-Meteo](https://open-meteo.com/); no API key is needed, and the free tier is for non-commercial use only.

Geolocation only works over HTTPS or on `localhost`. On plain HTTP the widget falls back to Dublin.
