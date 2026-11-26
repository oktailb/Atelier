# Atelier by GallusTech — Production Multi-Stage Docker Image (Phase C)
# Includes PHP 8.3-FPM, Nginx, Supervisor (with background worker), GD/WebP, EXIF, Zip, SQLite, cURL & FFmpeg

FROM php:8.3-fpm-alpine AS runtime

RUN apk add --no-cache \
      nginx \
      supervisor \
      ffmpeg \
      libpng-dev \
      libjpeg-turbo-dev \
      libwebp-dev \
      freetype-dev \
      libzip-dev \
      sqlite-dev \
      curl-dev \
      oniguruma-dev \
      icu-dev \
    && docker-php-ext-configure gd --with-freetype --with-jpeg --with-webp \
    && docker-php-ext-install -j$(nproc) gd exif zip pdo_sqlite curl mbstring intl opcache \
    && rm -rf /var/cache/apk/*

WORKDIR /var/www/html

COPY . /var/www/html
COPY docker/nginx.conf /etc/nginx/http.d/default.conf
COPY docker/php.ini /usr/local/etc/php/conf.d/99-atelier.ini
COPY docker/supervisord.conf /etc/supervisor/conf.d/supervisord.conf

RUN mkdir -p /var/www/html/storage/media /var/www/html/storage/users /var/www/html/storage/backups /var/www/html/storage/session /var/www/html/storage/.thumbnails /run/nginx \
    && chown -R www-data:www-data /var/www/html/storage /var/www/html/config

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1/api.php?action=get_locales > /dev/null || exit 1

CMD ["/usr/bin/supervisord", "-c", "/etc/supervisor/conf.d/supervisord.conf"]
