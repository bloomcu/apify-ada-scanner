# Specify the base Docker image. You can read more about
# the available images at https://crawlee.dev/docs/guides/docker-images
# You can also use any other image from Docker Hub.
# Keep the Puppeteer version in this tag equal to the one pinned in package.json.
FROM apify/actor-node-puppeteer-chrome:22-25.16.0

# Copy just package.json and package-lock.json
# to speed up the build using Docker layer cache.
COPY --chown=myuser package*.json ./

# Install exactly what package-lock.json pins, skipping optional and
# development dependencies to keep the image small. Install scripts log
# in the foreground, so a stalled download shows in the build log.
RUN npm --quiet set progress=false \
    && npm ci --omit=dev --omit=optional --foreground-scripts \
    && echo "Installed NPM packages:" \
    && (npm list --omit=dev --all || true) \
    && echo "Node.js version:" \
    && node --version \
    && echo "NPM version:" \
    && npm --version

# Next, copy the remaining files and directories with the source code.
# Since we do this after NPM install, quick build will be really fast
# for most source file changes.
COPY --chown=myuser . ./


# Run the image. If you know you won't need headful browsers,
# you can remove the XVFB start script for a micro perf gain.
CMD ./start_xvfb_and_run_cmd.sh && npm start --silent
