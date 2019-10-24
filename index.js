import axios from "axios";
import PDFDocument from "pdfkit";
import { ExifImage } from "exif";
import { DateTime } from "luxon";
import glob from "glob";

import generateHTML from "./generateHtml";

const fs = require("fs");
const request = require("request");

const GOOGLE_KEY = "AIzaSyAbGgh_WnGbHbaRA-mFm6W6XoLAj-_Ha3c";

const download = function(uri, filename, callback) {
  request.head(uri, function(err, res) {
    console.log("content-type:", res.headers["content-type"]);
    console.log("content-length:", res.headers["content-length"]);

    request(uri)
      .pipe(fs.createWriteStream(filename))
      .on("close", callback);
  });
};

/**
 * @return {number}
 */
function ConvertDMSToDD(input) {
  const [degrees, minutes, seconds, direction] = input.split(":");
  let dd = Number(degrees) + Number(minutes) / 60 + Number(seconds) / (60 * 60);

  if (direction === "S" || direction === "W") {
    dd = dd * -1;
  } // Don't do anything for N or E

  return dd;
}

const fetchExifImage = file =>
  new Promise((resolve, reject) => {
    new ExifImage({ image: `${file}` }, (error, exifData) => {
      if (error) {
        console.log(`Error: (${file}) - ${error.message}`);
        reject(error);
      } else {
        if (!exifData.gps.GPSLatitude || !exifData.gps.GPSLongitude) {
          reject(new Error(`Image ${file} does not have GPS exif data`));
        }

        console.log(file);

        const latitude = ConvertDMSToDD(
          `${exifData.gps.GPSLatitude.join(":")}:${exifData.gps.GPSLatitudeRef}`
        );
        const longitude = ConvertDMSToDD(
          `${exifData.gps.GPSLongitude.join(":")}:${
            exifData.gps.GPSLongitudeRef
          }`
        );

        resolve({
          latitude,
          longitude,
          dateTimeOriginal: exifData.exif.DateTimeOriginal
        });
      }
    });
  });

function getDirections(latlngs) {
  return new Promise((resolve, reject) => {
    const start = latlngs[0];
    const end = latlngs[latlngs.length - 1];
    const waypoints = latlngs.slice(1, -1);

    const requestUrl = `https://maps.googleapis.com/maps/api/directions/json?origin=${
      start.latitude
    },${start.longitude}&destination=${end.latitude},${
      end.longitude
    }${waypoints
      .map(p => `&waypoints=${p.latitude},${p.longitude}`)
      .join("")}&mode=bicycling&key=${GOOGLE_KEY}`;

    axios
      .get(requestUrl)
      .then(response => {
        const { overview_polyline, legs } = response.data.routes[0];
        const totalDistance = legs.reduce((total, leg) => {
          return (total += leg.distance.value);
        }, 0);

        resolve({
          polylineData: overview_polyline.points,
          totalDistance: totalDistance * 0.00062137 // convert to miles
        });
      })
      .catch(error => reject(error));
  });
}

function createTable(doc, data, width = 500) {
  const startY = doc.y,
    startX = doc.x,
    distanceY = 15,
    distanceX = 10;

  doc.fontSize(12);

  let currentY = startY;

  data.forEach(value => {
    let currentX = startX,
      size = value.length;

    let blockSize = width / size;

    value.forEach(text => {
      //Write text
      doc.text(text, currentX + distanceX, currentY);

      //Create rectangles
      doc
        .lineJoin("miter")
        .rect(currentX, currentY, blockSize, distanceY)
        .stroke();

      currentX += blockSize;
    });

    currentY += distanceY;
  });
}

function generatePDFDocument(config) {
  const doc = new PDFDocument();
  doc.pipe(fs.createWriteStream("generatedPDF.pdf"));
  doc.fontSize(25).text("Canal Navigation Report");

  doc
    .fontSize(18)
    .text(`Distance travelled: ${config.totalDistance.toFixed(1)} miles`);

  createTable(
    doc,
    config.fileLatLngs.reduce(
      (array, file) => {
        return array.concat([
          [
            file.latitude.toFixed(4),
            file.longitude.toFixed(4),
            file.dateTimeOriginal
          ]
        ]);
      },
      [["latitude", "longitude", "date"]]
    )
  );

  doc.text("____");

  doc.image("./map.jpg", {
    fit: [250, 300]
  });

  doc.end();
}

try {
  glob("images/*.jpg", null, (err, files) => {
    Promise.all(files.map(fetchExifImage)).then(fileLatLngs => {
      const fileLatLngsSorted = fileLatLngs.sort(
        (a, b) =>
          DateTime.fromFormat(a.dateTimeOriginal, "yyyy:MM:dd HH:mm:ss") -
          DateTime.fromFormat(b.dateTimeOriginal, "yyyy:MM:dd HH:mm:ss")
      );

      const markersAsString = fileLatLngsSorted
        .map(
          (file, index) =>
            `&markers=color:blue%7Clabel:${index}%7C${file.latitude},${file.longitude}`
        )
        .join("");

      getDirections(fileLatLngsSorted).then(routePolyLineData => {
        console.log(routePolyLineData.totalDistance);
        download(
          `https://maps.googleapis.com/maps/api/staticmap?size=800x500&maptype=roadmap${markersAsString}&path=weight:3|color:red|enc:${routePolyLineData.polylineData}&key=${GOOGLE_KEY}`,
          "./map.jpg",
          () => {
            // generatePDFDocument({
            //   fileLatLngs: fileLatLngsSorted,
            //   totalDistance: routePolyLineData.totalDistance
            // });
            generateHTML({
              foo: "bar",
              images: files,
              locations: fileLatLngsSorted
            });
            console.log("done");
          }
        );
      });
    });
  });
} catch (error) {
  console.log(`Error: ${error.message}`);
}
