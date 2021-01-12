# Runtime with wkhtmltopdf dependencies
FROM bitnami/minideb AS runtime
RUN install_packages \
    ca-certificates \
    libfreetype6 \
    libjpeg62-turbo \
    libpng16-16 \
    libx11-6 \
    libxcb1 \
    libxext6 \
    libxrender1 \
    xfonts-75dpi \
    xfonts-base \
    fontconfig \
    curl

# Node.js LTS
RUN curl -sL https://deb.nodesource.com/setup_lts.x | bash -
RUN apt-get install -y nodejs

# Patched version of wkhtmltopdf
RUN curl -sL -O https://github.com/wkhtmltopdf/packaging/releases/download/0.12.6-1/wkhtmltox_0.12.6-1.buster_amd64.deb
RUN dpkg -i ./wkhtmltox_0.12.6-1.buster_amd64.deb
RUN rm wkhtmltox_0.12.6-1.buster_amd64.deb
RUN apt-get clean

WORKDIR /app
RUN mkdir out
COPY package.json .
RUN npm install --silent
COPY main.js .

ENV PORT=3070

ENTRYPOINT ["node", "main.js"]
EXPOSE $PORT
