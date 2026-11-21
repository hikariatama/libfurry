FROM node:24.22.3-alpine@sha256:116b800c3754b440ee0aa3ed2f20f5bf3d99a554bfd9adeea09ea8017f6e85f5 AS test
WORKDIR /app
ENV ELECTRON_SKIP_BINARY_DOWNLOAD=1
COPY app/package.json app/package-lock.json ./
RUN npm ci
COPY app/ ./
RUN --network=none npm run lint && npm run typecheck
RUN --network=none mkdir /report && node --test \
    --test-reporter=spec --test-reporter-destination=stdout \
    --test-reporter=junit --test-reporter-destination=/report/junit.xml tests/*.test.cjs

FROM scratch AS test-report
COPY --from=test /report /

FROM nginx:1.31.9-alpine@sha256:fb4658584bd9a916ffb6f6e365f97c25cfdb2923801f551ea08356e695f14ff7
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY landing/ /usr/share/nginx/html/
EXPOSE 80
HEALTHCHECK --interval=15s --timeout=3s --start-period=5s --retries=3 CMD wget -q --spider http://127.0.0.1/ || exit 1
