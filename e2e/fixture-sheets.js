// Browser-test only: answers requests for the fixture spreadsheet from the local test
// server, so the app's real Google Sheets code path runs without the network.
(function () {
  var realFetch = window.fetch.bind(window);
  var FIXTURE = /docs\.google\.com\/spreadsheets\/d\/E2EFixtureSheet0+\//;
  window.fetch = function (input, init) {
    var url = typeof input === 'string' ? input : input && input.url;
    if (url && FIXTURE.test(url)) {
      var gid = new URL(url).searchParams.get('gid') || '0';
      return realFetch('/__e2e__/sheet/' + gid, { cache: 'no-store' });
    }
    return realFetch(input, init);
  };
})();
