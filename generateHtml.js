const fse = require("fs-extra");
const path = require("path");
const { promisify } = require("util");
const ejsRenderFile = promisify(require("ejs").renderFile);
const globP = promisify(require("glob"));

const distPath = "./output";

// clear destination folder
fse.emptyDirSync(distPath);

// copy assets folder
fse.copy("./images", `${distPath}/images`);
fse.copy(`./map.jpg`, `${distPath}/map.jpg`);
fse.copy(`./styles/styles.css`, `${distPath}/styles.css`);

export default function generateHTML(config) {
  globP("templates/report.ejs")
    .then(files => {
      files.forEach(file => {
        // create destination directory
        fse
          .mkdirs(distPath)
          .then(() => {
            // render page
            return ejsRenderFile(file, Object.assign({}, config));
          })
          .then(layoutContent => {
            // save the html file
            fse.writeFile(`${distPath}/report.html`, layoutContent);
          })
          .catch(err => {
            console.error(err);
          });
      });
    })
    .catch(err => {
      console.error(err);
    });
}
