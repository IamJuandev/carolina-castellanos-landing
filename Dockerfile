FROM nginx:1.27-alpine
COPY Landing/ /usr/share/nginx/html/
EXPOSE 80
