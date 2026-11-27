// À ajouter À LA FIN du main.js déployé (inchangé par ailleurs) : partage le client Mailjet existant avec les jobs, puis enregistre les jobs de rappel.
global.eleaseMailjet = mailjet;
require('./jobs');
