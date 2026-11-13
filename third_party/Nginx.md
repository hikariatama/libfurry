# Nginx landing container

The root Dockerfile uses the official [Nginx container image](https://hub.docker.com/_/nginx),
pinned by version and digest. This deployment definition was imported from the
existing Soft Serve landing repository; the image reference was preserved.

Nginx itself uses the [BSD 2-Clause license](https://nginx.org/LICENSE), copyright
Igor Sysoev and Nginx, Inc. The official image also contains Alpine packages with
their own licenses and notices. Preserve the upstream image's license materials
when building or redistributing the landing container. No Nginx source or binary
is copied into the Electron application.
