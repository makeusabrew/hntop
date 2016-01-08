"use strict";

const http = require("http");
const Bluebird = require("bluebird");
const redis = Bluebird.promisifyAll(require("redis"));
const request = Bluebird.promisifyAll(require("request"));

const client = redis.createClient();

const server = http.createServer((req, res) => {
  if (req.url === "/favicon.ico") {
    res.writeHead(404);
    return res.end();
  }

  console.time("request");

  return client.getAsync("cache:top:1")
  .then(id => {
    if (id) {
      console.log("Grabbed top story ID %d from cache", id);
      return id;
    }

    console.log("Top story cache is empty, requesting via API...");
    return request.getAsync("https://hacker-news.firebaseio.com/v0/topstories.json")
    .then(response => {
      const id = JSON.parse(response.body)[0];
      console.log("Got a fresh ID from API (%d), caching for a few seconds...", id);
      return client.setexAsync("cache:top:1", 10, id)
      .then(() => {
        return id;
      });
    });
  })
  .then(id => {
    console.log("Top story ID is %d", id);

    const key = "link:" + id;

    return client.getAsync(key)
    .then((result) => {
      if (result) {
        console.log("Got a URL for %d from redis cache", id);
        return result;
      }

      console.log("ID wasn't in cache, looking up URL");
      return request.getAsync("https://hacker-news.firebaseio.com/v0/item/" + id + ".json")
      .then(response => {
        const item = JSON.parse(response.body);
        let url = item.url;
        if (!url) {
          console.log("Item doesn't appear to have a URL, linking to HN instead...");
          url = "https://news.ycombinator.com/item?id=" + id;
        }
        return client.setAsync(key, url)
        .then(() => {
          return url;
        });
      });
    })
    .then(url => {
      if (req.url === "/comments") {
        console.log("User only wants comments, forcing HN url");
        url = "https://news.ycombinator.com/item?id=" + id;
      }

      return client.incrAsync("hit:" + id)
      .then(hitCount => {
        console.log("Hit count for %d is %d", id, hitCount);

        console.log("Redirecting to %s", url);
        console.timeEnd("request");
        console.log("\n");

        res.writeHead(302, {
          "Location": url
        });
        res.end();
      });
    });
  })
  .catch(e => {
    console.log(e.stack);
    process.exit(1);
  });
});

server.listen(process.env.PORT, () => {
  console.log("Listening on port %s", process.env.PORT);
});
